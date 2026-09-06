import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { getSparkServices, type SparkServices } from "./lib/firebase";
import "./styles.css";

let services: SparkServices | null = null;
let configError: string | undefined;
try {
  services = getSparkServices();
} catch {
  configError =
    "Konfigurasi Firebase Spark belum lengkap atau tidak aman. Hubungi operator; tidak ada koneksi database yang dibuka.";
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App services={services} configError={configError} />
  </StrictMode>,
);
