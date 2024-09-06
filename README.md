## ast-rag

This application uses OpenAI's assistant APIs to build a contextual searcher and summarizer on your files. To run this application you need [nodejs](https://nodejs.org/en/download/package-manager) (20+).

### To run

1. Create a .env file in the root directory and add the following entries:

```
OPENAI_API_KEY=<YOUR_OPENAI_API_KEY>

DEFAULT_PATHS=<COMMA_SEPARATED_PATHS_ON_YOUR_SYSTEM_THAT_YOU_WANT_INDEXED_AND_SEARCHABLE>
```

2. Install dependencies

```
npm install
```

3. Run app

```
node index.js
```
