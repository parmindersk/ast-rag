const dotenv = require("dotenv");
dotenv.config();
const OpenAI = require("openai");
const openai = new OpenAI();
const fs = require("fs");
const readline = require("node:readline");
const { setInterval, clearInterval } = require("timers");

const { getFilesFromFolders } = require("./fileHelper");

const blueText = (text) => {
  console.log("\x1b[34m", text, "\x1b[0m");
};

const configCache = process.env.OPENAI_CONFIG_CACHE || "config.json";
let config;

try {
  config = require(`./${configCache}`);
} catch (e) {
  config = {};
}

const saveToCache = (key, value) => {
  config[key] = value;
  fs.writeFileSync(configCache, JSON.stringify(config, null, 2));
};

async function vectorizeFiles(folderPaths) {
  if (config.vectorStoreId) {
    if (config.fileProcessed) {
      return config.vectorStoreId;
    }
    return config.vectorStoreId;
  }
  folderPaths = folderPaths || process.env.DEFAULT_PATHS;
  const { files, totalSize } = getFilesFromFolders(folderPaths.split(","));
  console.log(
    "Indexing ",
    files.length,
    " files with total size of ",
    totalSize / (1024 * 1024),
    "MB"
  );
  const fileStreams = files.map((path) => fs.createReadStream(path));
  let vectorStore;
  if (config.vectorStoreId) {
    vectorStore = await openai.beta.vectorStores.retrieve(config.vectorStoreId);
  } else {
    vectorStore = await openai.beta.vectorStores.create({
      name: process.env.VECTOR_STORE_NAME || "AssistantRAGFileStore",
    });
  }
  saveToCache("vectorStoreId", vectorStore.id);
  await openai.beta.vectorStores.fileBatches.uploadAndPoll(vectorStore.id, {
    files: fileStreams,
  });
  saveToCache("fileProcessed", true);
  console.log("Finished uploading files to vector store");
  console.log("Size of the vector store: ", vectorStore.size);
  return vectorStore.id;
}

async function createAssistant(paths) {
  if (config.assistantId) {
    return config.assistantId;
  }
  const assistant = await openai.beta.assistants.create({
    name: process.env.ASSISTANT_NAME || "File Assistant",
    instructions:
      process.env.DEFAULT_INSTRUCTIONS ||
      "You are an assistant who can help users find files on their computer, summarize them and provide information about the files. You can search for files by name, type, content or symantics. DO NOT show any sensitive information like name, address, SSN, date of birth, in your responses. Hide and redact them if needed. If the question is not about the document or can't be found in documents, you can use your own knowledge to provide the answer.",
    model: "gpt-4o",
    tools: [{ type: "file_search" }],
  });
  const vectorStoreId = await vectorizeFiles(paths);
  await openai.beta.assistants.update(assistant.id, {
    tool_resources: { file_search: { vector_store_ids: [vectorStoreId] } },
  });
  saveToCache("assistantId", assistant.id);
  return assistant.id;
}

const initRun = async (assistantId, threadId) => {
  const stream = openai.beta.threads.runs
    .stream(threadId, {
      assistant_id: assistantId,
    })
    .on("messageDone", async (event) => {
      if (event.content[0].type === "text") {
        showProgress(false);
        const { text } = event.content[0];
        const { annotations } = text;
        let citations = [];

        let index = 0;
        for (let annotation of annotations) {
          text.value = text.value.replace(annotation.text, "[" + index + "]");
          const { file_citation } = annotation;
          if (file_citation) {
            const citedFile = await openai.files.retrieve(
              file_citation.file_id
            );
            citations.push(citedFile.filename);
          }
          index++;
        }

        blueText(text.value);
        citations = [...new Set(citations)].map((c, i) => `${i + 1}. ${c}`);
        blueText(citations.join("\n"));
        console.log("\n\n");
        ask();
      }
    });
};
let progressInterval = null;

const showProgress = (status) => {
  if (status === true) {
    let progress = 0;
    progressInterval = setInterval(() => {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write("...." + progress++ + "s");
    }, 1000);
  } else {
    if (progressInterval) {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write("");
      clearInterval(progressInterval);
      progressInterval = null;
      progress = 0;
    }
  }
};

const initAll = async (paths) => {
  //create assistant
  const assistantId = await createAssistant();
  //create thread
  let threadId = config.threadId;
  if (!threadId) {
    const thread = await openai.beta.threads.create();
    threadId = thread.id;
    saveToCache("threadId", threadId);
  }
  //init run
  await initRun(assistantId, threadId);
  return { assistantId, threadId };
};

const createMessage = async (prompt) => {
  const { assistantId, threadId } = await initAll();
  await openai.beta.threads.messages.create(threadId, {
    role: "user",
    content: prompt,
  });
  showProgress(true);
};

module.exports = {
  createMessage,
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

const ask = async () => {
  rl.question("Singh: ", async (question) => {
    try {
      if (question === "exit") {
        process.exit(0);
      }
      if (question === "new") {
        await cleanThread();
        console.log("New thread created\n\n");
        ask();
        return;
      }
      if (question === "index") {
        await cleanThread();
        await vectorizeFiles();
        ask();
        return;
      }
      if (question === "reset") {
        await cleanUp();
        // await vectorizeFiles();
        ask();
        return;
      }
      if (question.trim() === "") {
        console.clear();
        console.log("\n");
        ask();
        return;
      }
      await createMessage(question);
      // console.log("\n\n");
      // await ask();
    } catch (error) {
      console.error(error);
    }
  });
};

const cleanThread = async () => {
  if (config.threadId) {
    const runs = await openai.beta.threads.runs.list(config.threadId);
    for (let run of runs.data) {
      if (run.status in ["queued", "in_progress", "requires_action"]) {
        console.log("Canceling run", run.id);
        await openai.beta.threads.runs.cancel(config.threadId, run.id);
      }
    }
    await openai.beta.threads.del(config.threadId);
    config.threadId = null;
    saveToCache("threadId", null);
  }
};

const cleanUp = async () => {
  await cleanThread();
  const assistants = await openai.beta.assistants.list();
  for (let ast of assistants.data) {
    console.log("Deleting assistant", ast.id);
    await openai.beta.assistants.del(ast.id);
  }

  const list = await openai.files.list();
  console.log("Deleting", list.data.length, "files");
  let f = 0;
  for await (const file of list) {
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write("...." + f++);
    await openai.files.del(file.id);
  }
  const vectorStores = await openai.beta.vectorStores.list();
  for (let vs of vectorStores.data) {
    console.log("Deleting vs", vs.id);
    await openai.beta.vectorStores.del(vs.id);
  }
  config = {};
  fs.writeFileSync(configCache, JSON.stringify(config, null, 2));
};

(async () => {
  // await cleanUp();
  await ask();
})();
