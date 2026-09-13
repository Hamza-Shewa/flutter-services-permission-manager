import { bus } from "../../core/bus.js";
import * as api from "../../core/api.js";
import {
  connectMcpButton,
  copyMcpConfigButton,
  mcpClientList,
  mcpClientsSummary,
  mcpConnectionsBackdrop,
  mcpConnectionsClose,
  mcpConnectionsError,
  mcpConnectionsRefresh,
  mcpManualConfig,
} from "../../core/elements.js";

let clients = [];
let installingClient = null;

function clientStateLabel(client) {
  if (client.state === "installed") { return "Connected"; }
  if (client.state === "outdated") { return "Update available"; }
  if (client.state === "unavailable") { return "Not detected"; }
  if (client.state === "error") { return "Error"; }
  return "Not connected";
}

function installButtonLabel(client) {
  if (installingClient === client.id) { return "Connecting…"; }
  if (client.state === "installed") { return "Connected"; }
  if (client.state === "outdated") { return "Update"; }
  if (client.id === "cursor" && !client.detected) { return "Create global config"; }
  return "Connect";
}

function renderSummary(loading = false) {
  if (!mcpClientsSummary || !connectMcpButton) { return; }
  if (loading) {
    mcpClientsSummary.dataset.state = "checking";
    mcpClientsSummary.textContent = "Checking MCP clients…";
    return;
  }
  const installed = clients.filter((client) => client.state === "installed").length;
  const available = clients.filter((client) => client.detected || client.id === "cursor").length;
  mcpClientsSummary.dataset.state = installed > 0 ? "installed" : "not-installed";
  mcpClientsSummary.textContent = installed > 0
    ? `${installed} MCP client${installed === 1 ? "" : "s"} connected`
    : `${available} compatible client${available === 1 ? "" : "s"} available`;
  mcpClientsSummary.title = clients.map((client) => `${client.label}: ${clientStateLabel(client)}`).join("\n");
}

function renderClients() {
  if (!mcpClientList) { return; }
  mcpClientList.innerHTML = "";
  clients.forEach((client) => {
    const row = document.createElement("div");
    row.className = "mcp-client-row";

    const identity = document.createElement("div");
    const label = document.createElement("strong");
    label.textContent = client.label;
    const state = document.createElement("div");
    state.className = `mcp-client-state ${client.state}`;
    state.textContent = clientStateLabel(client);
    identity.append(label, state);

    const message = document.createElement("div");
    message.className = "mcp-client-meta";
    message.textContent = client.message;

    const button = document.createElement("button");
    button.type = "button";
    button.className = client.state === "installed" ? "btn-secondary" : "btn-primary";
    button.textContent = installButtonLabel(client);
    button.disabled = client.state === "installed" || !client.canInstall || installingClient !== null;
    button.addEventListener("click", () => {
      installingClient = client.id;
      renderClients();
      api.installMcpClient(client.id);
    });

    row.append(identity, message, button);
    mcpClientList.appendChild(row);
  });
}

function openConnections() {
  if (mcpConnectionsBackdrop) { mcpConnectionsBackdrop.style.display = "flex"; }
  api.checkMcpClients();
}

connectMcpButton?.addEventListener("click", openConnections);
mcpConnectionsClose?.addEventListener("click", () => {
  if (mcpConnectionsBackdrop) { mcpConnectionsBackdrop.style.display = "none"; }
});
mcpConnectionsRefresh?.addEventListener("click", () => api.checkMcpClients());
copyMcpConfigButton?.addEventListener("click", () => api.copyMcpConfig());

bus.on("mcpClientInstalling", (message) => {
  installingClient = message.client;
  renderClients();
});

bus.on("mcpClientsStatus", (message) => {
  if (message.loading) {
    installingClient = "checking";
    renderSummary(true);
    renderClients();
    return;
  }
  installingClient = null;
  clients = message.clients || [];
  if (mcpConnectionsError) {
    mcpConnectionsError.textContent = message.error || "";
    mcpConnectionsError.style.display = message.error ? "block" : "none";
  }
  if (mcpManualConfig) { mcpManualConfig.textContent = message.manualConfig || ""; }
  renderSummary(false);
  renderClients();
});

bus.on("mcpConfigCopied", () => {
  if (!copyMcpConfigButton) { return; }
  copyMcpConfigButton.textContent = "Copied";
  setTimeout(() => { copyMcpConfigButton.textContent = "Copy configuration"; }, 1500);
});

// MCP covers the whole extension, so status is checked with the global view.
api.checkMcpClients();
