import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// React 19 入口
// createRoot API 来自 React 18+，并发渲染根容器
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
