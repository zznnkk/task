const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("crawlerApi", {
  getButtons: () => ipcRenderer.invoke("buttons:list"),

  // searchTerms: [{ rowIndex, term, values }, ...]
  // values[i] = 해당 행에서 i번째 사이트(열)에 현재 들어있는 값
  // checkedSiteIndexes: 체크박스로 선택된 사이트들의 인덱스 배열 (buttons 순서 기준)
  startCrawl: (searchTerms, checkedSiteIndexes) =>
    ipcRenderer.invoke("crawl:start", searchTerms, checkedSiteIndexes),

  stopCrawl: () => ipcRenderer.invoke("crawl:stop"),

  // callback({ rowIndex, colIndex, text })
  onProgress: (callback) => {
    ipcRenderer.on("crawl:progress", (event, data) => callback(data));
  },

  // callback({ stopped })
  onDone: (callback) => {
    ipcRenderer.on("crawl:done", (event, data) => callback(data));
  }
});
