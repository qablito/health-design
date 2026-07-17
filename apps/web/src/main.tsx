import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AccessApp } from "./features/access/AccessApp";
import { AdminApp } from "./features/admin/AdminApp";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("No se encontró el elemento raíz de la aplicación.");
}

createRoot(rootElement).render(
  <StrictMode>
    {window.location.pathname.startsWith("/admin") ? <AdminApp /> : <AccessApp />}
  </StrictMode>,
);
