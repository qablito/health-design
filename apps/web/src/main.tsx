import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { getWebRuntimeSmoke } from "./runtime-smoke";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("No se encontró el elemento raíz de la aplicación.");
}

const runtimeSmoke = getWebRuntimeSmoke();

createRoot(rootElement).render(
  <StrictMode>
    <main>
      <h1>Health Design</h1>
      <p>Fundación técnica de la Tarea 1.</p>
      <pre aria-label="Contrato compartido">
        {JSON.stringify(runtimeSmoke, null, 2)}
      </pre>
    </main>
  </StrictMode>,
);
