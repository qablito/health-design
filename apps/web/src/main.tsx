import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AccessApp } from "./features/access/AccessApp";
import { AdminApp } from "./features/admin/AdminApp";
import { NutritionApp } from "./features/nutrition/NutritionApp";
import { QuestionnaireRoute } from "./routes/questionnaire";
import { registerPublicAssetWorker } from "./services/client-cache";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("No se encontró el elemento raíz de la aplicación.");
}

void registerPublicAssetWorker().catch(() => undefined);

createRoot(rootElement).render(
  <StrictMode>
    {window.location.pathname.startsWith("/admin") ? (
      <AdminApp />
    ) : window.location.pathname.startsWith("/questionnaire") ? (
      <QuestionnaireRoute />
    ) : window.location.pathname.startsWith("/nutrition") ? (
      <NutritionApp />
    ) : (
      <AccessApp />
    )}
  </StrictMode>,
);
