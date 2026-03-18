import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./styles.css";
import "./theme-default.css";
import "./i18n/index.js";
import { App } from "./App.js";
import { ApolloWrapper } from "./providers/ApolloWrapper.js";
import { AuthProvider } from "./providers/AuthProvider.js";
import { ToastProvider } from "./components/Toast.js";
import { GraphQLLoadingProvider } from "./contexts/GraphQLLoadingContext.js";
import { ToolRegistryProvider } from "./providers/ToolRegistryProvider.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ApolloWrapper>
      <GraphQLLoadingProvider>
        <AuthProvider>
          <ToolRegistryProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </ToolRegistryProvider>
        </AuthProvider>
      </GraphQLLoadingProvider>
    </ApolloWrapper>
  </StrictMode>,
);
