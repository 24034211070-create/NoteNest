
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import NoteNest from "./Frontend/components/NoteNest/NoteNest.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <NoteNest />
  </StrictMode>
);
