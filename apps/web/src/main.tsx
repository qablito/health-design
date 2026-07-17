import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AccessApp } from "./features/access/AccessApp";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("No se encontró el elemento raíz de la aplicación.");
}

createRoot(rootElement).render(
  <StrictMode>
    <AccessApp />
  </StrictMode>,
);
