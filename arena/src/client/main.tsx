import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
const root = document.getElementById("root");
if (!root) throw Error("앱 마운트 지점을 찾을 수 없습니다.");
createRoot(root).render(<App />);
