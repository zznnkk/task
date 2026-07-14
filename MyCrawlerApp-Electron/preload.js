const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("crawlerApi", {
  getButtons: () => ipcRenderer.invoke("buttons:list"),

  // searchTerms: [{ rowIndex, term }, ...]
  startCrawl: (id, searchTerms) =>
    ipcRenderer.invoke("crawl:start", id, searchTerms),

  stopCrawl: () => ipcRenderer.invoke("crawl:stop"),

  // callback({ rowIndex, text })
  onProgress: (callback) => {
    ipcRenderer.on("crawl:progress", (event, data) => callback(data));
  },

  // callback({ stopped })
  onDone: (callback) => {
    ipcRenderer.on("crawl:done", (event, data) => callback(data));
  }
});
