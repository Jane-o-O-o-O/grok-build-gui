(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const api = window.grokDesktop || null;
  const STORAGE_KEY = "grok-desktop-state-v1";

  const defaultState = {
    cwd: "E:\\interesting\\grok-build-kunkun",
    theme: "dark",
    model: "auto",
    modelLabel: "自动模型",
    effort: "high",
    effortLabel: "高思考",
    alwaysApprove: false,
    activeThreadId: null,
    threads: [],
    attachments: [],
    inspectorOpen: true,
    sidebarHidden: false,
    dockTabs: [{ id: "tasks", type: "tasks", title: "侧边任务" }],
    activeDockTabId: "tasks"
  };

  let state = loadState();
  let activeRun = null;
  let activeAssistantMessage = null;
  let startedAt = 0;
  let durationTimer = null;
  let runtimeModels = [{ id: "auto", label: "自动模型" }];
  let streamRenderFrame = null;
  let pickerPopover = null;
  let providerDiscovery = null;
  let savedProviders = [];

  const dockTypes = {
    review: { title: "审阅", icon: "i-review", description: "查看 Git 工作区改动" },
    terminal: { title: "终端", icon: "i-terminal", description: "运行本地 Shell 命令" },
    browser: { title: "浏览器", icon: "i-browser", description: "打开网页与本地服务" },
    files: { title: "文件", icon: "i-file", description: "浏览和预览工作区文件" },
    tasks: { title: "侧边任务", icon: "i-tasks", description: "追踪当前 Grok 活动" }
  };

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      const merged = { ...defaultState, ...saved, attachments: [] };
      if (!Array.isArray(merged.dockTabs) || !merged.dockTabs.length) merged.dockTabs = structuredClone(defaultState.dockTabs);
      if (!merged.dockTabs.some((tab) => tab.id === merged.activeDockTabId)) merged.activeDockTabId = merged.dockTabs[0].id;
      return merged;
    } catch {
      return structuredClone(defaultState);
    }
  }

  function saveState() {
    const persistent = { ...state, attachments: [] };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistent));
  }

  function uid() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function activeThread() {
    return state.threads.find((thread) => thread.id === state.activeThreadId) || null;
  }

  function createThread(title = "新会话") {
    const thread = {
      id: uid(),
      sessionId: null,
      title,
      cwd: state.cwd,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: []
    };
    state.threads.unshift(thread);
    state.activeThreadId = thread.id;
    saveState();
    renderAll();
    setTimeout(() => $("#promptInput").focus(), 0);
    return thread;
  }

  function removeThread(id) {
    const index = state.threads.findIndex((thread) => thread.id === id);
    if (index < 0) return;
    state.threads.splice(index, 1);
    if (state.activeThreadId === id) state.activeThreadId = state.threads[0]?.id || null;
    saveState();
    renderAll();
  }

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  function inlineMarkdown(value) {
    return value
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>');
  }

  function markdown(source = "") {
    const escaped = escapeHtml(source).replace(/\r\n/g, "\n");
    const blocks = [];
    let text = escaped.replace(/```([^\n]*)\n([\s\S]*?)```/g, (_match, language, code) => {
      const id = blocks.length;
      blocks.push(`<div class="code-block"><div class="code-block__head"><span>${language || "text"}</span><button class="icon-button copy-code" title="复制"><svg><use href="#i-copy"/></svg></button></div><pre>${code.replace(/\n$/, "")}</pre></div>`);
      return `\n@@BLOCK${id}@@\n`;
    });
    const lines = text.split("\n");
    const output = [];
    let list = null;
    for (const raw of lines) {
      const line = raw.trimEnd();
      const placeholder = line.match(/^@@BLOCK(\d+)@@$/);
      if (placeholder) {
        if (list) { output.push(`</${list}>`); list = null; }
        output.push(blocks[Number(placeholder[1])]);
      } else if (/^###\s+/.test(line)) {
        if (list) { output.push(`</${list}>`); list = null; }
        output.push(`<h3>${inlineMarkdown(line.replace(/^###\s+/, ""))}</h3>`);
      } else if (/^##\s+/.test(line)) {
        if (list) { output.push(`</${list}>`); list = null; }
        output.push(`<h2>${inlineMarkdown(line.replace(/^##\s+/, ""))}</h2>`);
      } else if (/^[-*]\s+/.test(line)) {
        if (list !== "ul") { if (list) output.push(`</${list}>`); output.push("<ul>"); list = "ul"; }
        output.push(`<li>${inlineMarkdown(line.replace(/^[-*]\s+/, ""))}</li>`);
      } else if (/^\d+\.\s+/.test(line)) {
        if (list !== "ol") { if (list) output.push(`</${list}>`); output.push("<ol>"); list = "ol"; }
        output.push(`<li>${inlineMarkdown(line.replace(/^\d+\.\s+/, ""))}</li>`);
      } else if (!line.trim()) {
        if (list) { output.push(`</${list}>`); list = null; }
      } else {
        if (list) { output.push(`</${list}>`); list = null; }
        output.push(`<p>${inlineMarkdown(line)}</p>`);
      }
    }
    if (list) output.push(`</${list}>`);
    return output.join("");
  }

  function welcomeMarkup() {
    return `<div class="welcome">
      <div class="welcome-mark" aria-hidden="true"></div>
      <h1>构建下一件重要的事。</h1>
      <p>Grok Build 已连接到你的本地工作区。描述目标，它会理解代码、执行工具并验证结果。</p>
      <div class="quick-actions">
        <button class="quick-action" data-prompt="分析这个代码库的架构，并指出最值得优先改进的三个地方"><b>理解代码库</b><small>绘制架构与依赖关系</small><svg><use href="#i-arrow-up"/></svg></button>
        <button class="quick-action" data-prompt="检查当前 Git 改动，找出潜在 bug 并直接修复"><b>审查当前改动</b><small>检查风险并运行验证</small><svg><use href="#i-arrow-up"/></svg></button>
        <button class="quick-action" data-prompt="运行项目测试，定位失败原因并修复"><b>修复测试</b><small>执行、诊断、迭代</small><svg><use href="#i-arrow-up"/></svg></button>
        <button class="quick-action" data-prompt="为这个项目补充一份清晰的开发者文档"><b>整理项目文档</b><small>生成可维护的说明</small><svg><use href="#i-arrow-up"/></svg></button>
      </div>
    </div>`;
  }

  function messageMarkup(message) {
    if (message.kind === "tool") {
      return `<div class="tool-card"><div class="tool-card__head"><svg><use href="#i-terminal"/></svg><b>${escapeHtml(message.title || "Grok runtime")}</b><small>${escapeHtml(message.status || "activity")}</small></div><div class="tool-card__body">${escapeHtml(message.text)}</div></div>`;
    }
    const assistant = message.role === "assistant";
    const identity = assistant ? '<span class="grok-mark" aria-hidden="true"></span>' : "YOU";
    return `<article class="message message--${assistant ? "assistant" : "user"}" data-message-id="${message.id}">
      <div class="message__meta"><span class="message__identity">${identity}</span><b>${assistant ? "Grok" : "你"}</b><span>${formatTime(message.createdAt)}</span></div>
      <div class="message__body">${assistant ? markdown(message.text) : escapeHtml(message.text)}</div>
      ${assistant ? '<div class="message-actions"><button class="icon-button copy-message" title="复制"><svg><use href="#i-copy"/></svg></button></div>' : ""}
    </article>`;
  }

  function renderMessages() {
    const thread = activeThread();
    const target = $("#messages");
    if (!thread || !thread.messages.length) target.innerHTML = welcomeMarkup();
    else target.innerHTML = thread.messages.map(messageMarkup).join("");
    bindDynamicActions();
    updateWindowTrail();
  }

  // Streaming chunks can arrive only a few characters apart. Rebuilding the whole
  // conversation for every chunk resets layout, selection and hover state, which
  // presents as a full-page flash. Keep the message nodes stable and update only
  // the active answer, at most once per animation frame.
  function scheduleStreamingRender() {
    if (streamRenderFrame) return;
    const conversation = $("#conversation");
    const followOutput = conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight < 140;
    streamRenderFrame = requestAnimationFrame(() => {
      streamRenderFrame = null;
      if (!activeAssistantMessage) return;
      const article = $(`[data-message-id="${activeAssistantMessage.id}"]`);
      const body = article?.querySelector(".message__body");
      if (!body) return;
      body.innerHTML = markdown(activeAssistantMessage.text);
      bindMessageBody(body);
      if (followOutput) conversation.scrollTop = conversation.scrollHeight;
    });
  }

  function renderThreads() {
    const target = $("#threadList");
    if (!state.threads.length) {
      target.innerHTML = '<div class="context-empty" style="margin:8px"><span>还没有任务<br>从上方新建一个</span></div>';
      return;
    }
    const groups = groupThreads(state.threads);
    target.innerHTML = Object.entries(groups).map(([label, threads]) => `<div class="thread-group-label">${label}</div>${threads.map((thread) => `
      <button class="thread-item ${thread.id === state.activeThreadId ? "is-active" : ""}" data-thread-id="${thread.id}">${escapeHtml(thread.title)}<span class="icon-button thread-item__menu" data-remove-thread="${thread.id}"><svg><use href="#i-more"/></svg></span></button>`).join("")}`).join("");
    $$('[data-thread-id]').forEach((button) => button.addEventListener("click", (event) => {
      if (event.target.closest("[data-remove-thread]")) return;
      state.activeThreadId = button.dataset.threadId;
      saveState(); renderAll();
    }));
    $$('[data-remove-thread]').forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation(); removeThread(button.dataset.removeThread);
    }));
  }

  function groupThreads(threads) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yesterday = today.getTime() - 86400000;
    return threads.reduce((groups, thread) => {
      const label = thread.updatedAt >= today.getTime() ? "今天" : thread.updatedAt >= yesterday ? "昨天" : "更早";
      (groups[label] ||= []).push(thread); return groups;
    }, {});
  }

  function formatTime(time) {
    return new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function basename(filePath) {
    return String(filePath).split(/[\\/]/).filter(Boolean).pop() || filePath;
  }

  function renderAttachments() {
    $("#attachmentList").innerHTML = state.attachments.map((file, index) => `<div class="attachment-chip"><svg><use href="#i-paperclip"/></svg><span>${escapeHtml(basename(file))}</span><button data-remove-attachment="${index}"><svg><use href="#i-x"/></svg></button></div>`).join("");
    $$('[data-remove-attachment]').forEach((button) => button.addEventListener("click", () => { state.attachments.splice(Number(button.dataset.removeAttachment), 1); renderAttachments(); }));
    renderContextFiles();
  }

  function renderContextFiles() {
    const target = $("#contextFiles");
    $("#fileCount").textContent = `${state.attachments.length} FILES`;
    if (!state.attachments.length) {
      target.className = "context-empty";
      target.innerHTML = '<svg><use href="#i-folder"/></svg><span>附件和修改过的文件会显示在这里</span>';
    } else {
      target.className = "context-files";
      target.innerHTML = state.attachments.map((file) => `<button class="context-file" data-file="${escapeHtml(file)}"><svg><use href="#i-paperclip"/></svg><span>${escapeHtml(basename(file))}</span></button>`).join("");
    }
  }

  function renderAll() {
    renderThreads(); renderMessages(); renderAttachments(); renderDockTabs(); updateLayout(); updateWorkspace();
  }

  function renderDockTabs() {
    const target = $("#dockTabs");
    target.innerHTML = state.dockTabs.map((tab) => {
      const definition = dockTypes[tab.type] || dockTypes.tasks;
      return `<button class="dock-tab ${tab.id === state.activeDockTabId ? "is-active" : ""}" data-dock-tab="${tab.id}"><svg><use href="#${definition.icon}"/></svg><span>${escapeHtml(tab.title || definition.title)}</span>${state.dockTabs.length > 1 ? `<i class="dock-tab__close" data-close-dock="${tab.id}"><svg><use href="#i-x"/></svg></i>` : ""}</button>`;
    }).join("");
    const active = state.dockTabs.find((tab) => tab.id === state.activeDockTabId) || state.dockTabs[0];
    $$("[data-dock-pane]").forEach((pane) => pane.classList.toggle("is-active", pane.dataset.dockPane === active?.type));
    $$('[data-dock-tab]').forEach((button) => button.addEventListener("click", (event) => {
      if (event.target.closest("[data-close-dock]")) return;
      state.activeDockTabId = button.dataset.dockTab;
      saveState(); renderDockTabs(); refreshActiveDockPane();
    }));
    $$('[data-close-dock]').forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation(); closeDockTab(button.dataset.closeDock);
    }));
  }

  function openDockType(type) {
    const definition = dockTypes[type];
    if (!definition) return;
    let tab = state.dockTabs.find((item) => item.type === type);
    if (!tab) {
      tab = { id: `${type}-${uid()}`, type, title: definition.title };
      state.dockTabs.push(tab);
    }
    state.activeDockTabId = tab.id;
    state.inspectorOpen = true;
    $("#dockTabPicker").hidden = true;
    saveState(); renderDockTabs(); updateLayout(); refreshActiveDockPane();
  }

  function closeDockTab(tabId) {
    if (state.dockTabs.length <= 1) return;
    const index = state.dockTabs.findIndex((tab) => tab.id === tabId);
    if (index < 0) return;
    const wasActive = state.activeDockTabId === tabId;
    state.dockTabs.splice(index, 1);
    if (wasActive) state.activeDockTabId = state.dockTabs[Math.max(0, index - 1)].id;
    saveState(); renderDockTabs(); refreshActiveDockPane();
  }

  function renderDockTabPicker() {
    $("#dockTabPicker").innerHTML = Object.entries(dockTypes).map(([type, item]) => `<button class="dock-tab-choice" data-open-dock="${type}"><svg><use href="#${item.icon}"/></svg><span><b>${item.title}</b><small>${item.description}</small></span></button>`).join("");
    $$('[data-open-dock]').forEach((button) => button.addEventListener("click", () => openDockType(button.dataset.openDock)));
  }

  function activeDockType() {
    return state.dockTabs.find((tab) => tab.id === state.activeDockTabId)?.type || "tasks";
  }

  function refreshActiveDockPane() {
    const type = activeDockType();
    if (type === "review") refreshReview();
    if (type === "files") refreshWorkspaceFiles();
    if (type === "terminal") $("#terminalCwd").textContent = basename(state.cwd);
  }

  async function refreshReview() {
    const summary = $("#reviewSummary");
    summary.className = "review-summary";
    summary.textContent = "正在读取 Git 工作区…";
    if (!api) { summary.textContent = "桌面模式下读取 Git 审阅信息"; return; }
    const result = await api.reviewWorkspace(state.cwd);
    if (!result.ok) { summary.textContent = result.error; return; }
    summary.classList.toggle("is-clean", result.clean);
    summary.textContent = result.clean ? "工作区干净，没有待审阅改动。" : (result.stat || `${result.files.length} 个文件发生变化`);
    $("#reviewFiles").innerHTML = result.files.map((file) => `<button class="review-file" data-review-file="${escapeHtml(file.path)}"><i>${escapeHtml(file.status)}</i><span>${escapeHtml(file.path)}</span></button>`).join("");
    $$('[data-review-file]').forEach((button) => button.addEventListener("click", () => { openDockType("files"); openWorkspaceFile(button.dataset.reviewFile); }));
  }

  async function refreshWorkspaceFiles() {
    const list = $("#workspaceFileList");
    list.innerHTML = '<div class="context-empty"><span>正在建立文件索引…</span></div>';
    if (!api) { list.innerHTML = '<div class="context-empty"><span>桌面模式下浏览工作区文件</span></div>'; return; }
    const result = await api.listWorkspaceFiles(state.cwd);
    if (!result.ok) { list.innerHTML = `<div class="context-empty"><span>${escapeHtml(result.error)}</span></div>`; return; }
    list.innerHTML = result.files.map((file) => `<button class="workspace-file" data-workspace-file="${escapeHtml(file.path)}"><svg><use href="#i-file"/></svg><span>${escapeHtml(file.path)}</span><small>${formatBytes(file.size)}</small></button>`).join("");
    $$('[data-workspace-file]').forEach((button) => button.addEventListener("click", () => openWorkspaceFile(button.dataset.workspaceFile)));
  }

  function formatBytes(size) {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} K`;
    return `${(size / 1024 / 1024).toFixed(1)} M`;
  }

  async function openWorkspaceFile(file) {
    $("#filePreviewTitle").textContent = file;
    $("#filePreviewContent").textContent = "正在读取…";
    $$('[data-workspace-file]').forEach((button) => button.classList.toggle("is-active", button.dataset.workspaceFile === file));
    if (!api) return;
    const result = await api.readWorkspaceFile(state.cwd, file);
    $("#filePreviewContent").textContent = result.ok ? result.content : result.error;
  }

  function updateLayout() {
    $("#appShell").classList.toggle("is-sidebar-hidden", state.sidebarHidden);
    $("#appShell").classList.toggle("is-inspector-open", state.inspectorOpen);
    document.documentElement.dataset.theme = resolvedTheme();
    updateSwitches();
  }

  function resolvedTheme() {
    if (state.theme !== "system") return state.theme;
    return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  function updateWorkspace() {
    const name = basename(state.cwd);
    $("#workspaceName").textContent = name;
    $("#workspacePath").textContent = state.cwd;
    $("#cwdLabel").textContent = name;
    $("#modelLabel").textContent = state.modelLabel;
    $("#effortLabel").textContent = state.effortLabel;
  }

  function updateWindowTrail() {
    const thread = activeThread();
    $("#windowTrail").innerHTML = `<span>${escapeHtml(basename(state.cwd))}</span><b>/</b><span>${escapeHtml(thread?.title || "新会话")}</span>`;
  }

  function updateSwitches() {
    [$("#approvalSwitch"), $("#settingsApproval")].forEach((el) => el?.setAttribute("aria-checked", String(state.alwaysApprove)));
    $("#permissionLabel").textContent = state.alwaysApprove ? "自动批准" : "每次询问";
    $("#themeSelect").value = state.theme;
  }

  function bindDynamicActions() {
    $$(".quick-action").forEach((button) => button.addEventListener("click", () => { $("#promptInput").value = button.dataset.prompt; autoSizeInput(); $("#promptInput").focus(); }));
    $$(".copy-message").forEach((button) => button.addEventListener("click", async () => {
      const id = button.closest(".message").dataset.messageId;
      const message = activeThread()?.messages.find((item) => item.id === id);
      if (message) { await navigator.clipboard.writeText(message.text); toast("已复制", "回复已复制到剪贴板"); }
    }));
    $$(".message__body").forEach(bindMessageBody);
  }

  function bindMessageBody(body) {
    $$(".copy-code", body).forEach((button) => button.addEventListener("click", async () => { await navigator.clipboard.writeText(button.closest(".code-block").querySelector("pre").textContent); toast("已复制", "代码块已复制"); }));
    $$("a", body).forEach((link) => link.addEventListener("click", (event) => { if (api) { event.preventDefault(); api.openExternal(link.href); } }));
  }

  function setRunning(running) {
    const button = $("#sendButton");
    $("#sessionState").classList.toggle("is-running", running);
    $("#sessionState").lastChild.textContent = running ? "Grok 正在工作" : "准备就绪";
    button.classList.toggle("is-stop", running);
    button.innerHTML = `<svg><use href="#${running ? "i-stop" : "i-send"}"/></svg>`;
    if (running) {
      startedAt = Date.now();
      clearInterval(durationTimer);
      durationTimer = setInterval(() => $("#turnDuration").textContent = `${((Date.now() - startedAt) / 1000).toFixed(1)} S`, 100);
    } else clearInterval(durationTimer);
  }

  function addTimeline(title, detail, status = "done") {
    const list = $("#activityTimeline");
    if (list.children.length > 6) list.removeChild(list.children[1]);
    list.insertAdjacentHTML("beforeend", `<li class="is-${status}"><i>${status === "done" ? '<svg><use href="#i-check"/></svg>' : ""}</i><span><b>${escapeHtml(title)}</b><small>${escapeHtml(detail)}</small></span></li>`);
  }

  async function sendPrompt() {
    if (activeRun) { if (api) await api.cancelPrompt(activeRun); finishRun("已停止"); return; }
    const input = $("#promptInput");
    const prompt = input.value.trim();
    if (!prompt) return;
    const thread = activeThread() || createThread(prompt.slice(0, 34));
    if (!thread.messages.length) thread.title = prompt.replace(/\s+/g, " ").slice(0, 34);
    thread.messages.push({ id: uid(), role: "user", text: prompt, createdAt: Date.now() });
    activeAssistantMessage = { id: uid(), role: "assistant", text: "", thought: "", createdAt: Date.now() };
    thread.messages.push(activeAssistantMessage);
    thread.updatedAt = Date.now();
    input.value = ""; input.style.height = "auto";
    saveState(); renderAll(); scrollToBottom(); setRunning(true);
    addTimeline("提交任务", prompt.slice(0, 42), "done");
    addTimeline("Grok 推理", "等待首个响应片段", "active");

    if (!api) {
      activeRun = `demo-${uid()}`;
      simulatePrompt(prompt);
      return;
    }
    const result = await api.sendPrompt({ prompt, cwd: thread.cwd || state.cwd, sessionId: thread.sessionId, model: state.model, effort: state.effort, alwaysApprove: state.alwaysApprove, attachments: state.attachments });
    if (!result.ok) { activeAssistantMessage.text = `启动 Grok 时出现问题：${result.error}`; toast("Runtime 错误", result.error); finishRun("启动失败"); renderMessages(); return; }
    activeRun = result.runId;
    state.attachments = [];
    renderAttachments();
  }

  function simulatePrompt(prompt) {
    const response = `我已收到任务：**${prompt}**\n\n桌面预览模式已启用。安装依赖并通过 Electron 启动后，这里会实时呈现 Grok Build 的思考与回答流。\n\n- 会话 ID 自动续接\n- 工作区与附件会传给本地 runtime\n- 支持中止、主题和任务历史`;
    let index = 0;
    const timer = setInterval(() => {
      if (!activeRun) return clearInterval(timer);
      activeAssistantMessage.text += response.slice(index, index + 5); index += 5;
      scheduleStreamingRender();
      if (index >= response.length) { clearInterval(timer); finishRun("预览完成"); }
    }, 35);
  }

  function handleRunEvent(event) {
    if (!activeRun || event.runId !== activeRun) return;
    if (event.type === "text") {
      activeAssistantMessage.text += event.data || "";
      scheduleStreamingRender();
    } else if (event.type === "thought") {
      activeAssistantMessage.thought = (activeAssistantMessage.thought || "") + (event.data || "");
    } else if (event.type === "diagnostic") {
      const thread = activeThread();
      const existing = thread.messages.at(-2)?.kind === "tool" ? thread.messages.at(-2) : null;
      if (existing) existing.text = `${existing.text}\n${event.data}`.slice(-2400);
      addTimeline("Runtime 活动", String(event.data).slice(0, 55), "done");
    } else if (event.type === "error") {
      activeAssistantMessage.text += `\n\n**错误：** ${event.message}`;
      toast("Grok 返回错误", event.message);
    } else if (event.type === "end") {
      const thread = activeThread();
      thread.sessionId = event.sessionId || thread.sessionId;
      finishRun(event.stopReason || "完成");
    } else if (event.type === "process_exit" && event.code !== 0) {
      finishRun(`进程退出 ${event.code ?? event.signal}`);
    }
  }

  function finishRun(reason) {
    const thread = activeThread();
    if (thread && activeAssistantMessage && !activeAssistantMessage.text) activeAssistantMessage.text = "任务已结束。";
    if (thread) thread.updatedAt = Date.now();
    activeRun = null; activeAssistantMessage = null;
    setRunning(false); saveState(); renderThreads(); renderMessages();
    addTimeline("任务结束", reason, "done");
  }

  function scrollToBottom() { requestAnimationFrame(() => { const el = $("#conversation"); el.scrollTop = el.scrollHeight; }); }
  function autoSizeInput() { const el = $("#promptInput"); el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 180)}px`; }

  async function chooseWorkspace() {
    if (!api) { toast("桌面预览", "Electron 中可选择本地工作区"); return; }
    const cwd = await api.pickWorkspace();
    if (cwd) { state.cwd = cwd; const thread = activeThread(); if (thread && !thread.messages.length) thread.cwd = cwd; saveState(); updateWorkspace(); updateWindowTrail(); refreshActiveDockPane(); toast("已切换工作区", cwd); }
  }

  async function chooseFiles() {
    if (!api) { state.attachments = ["src/main.rs", "Cargo.toml"]; renderAttachments(); return; }
    const files = await api.pickFiles();
    state.attachments.push(...files.filter((file) => !state.attachments.includes(file))); renderAttachments();
  }

  function toggleApproval() { state.alwaysApprove = !state.alwaysApprove; saveState(); updateSwitches(); }
  function openPalette() {
    const backdrop = $("#paletteBackdrop"); backdrop.hidden = false; $("#paletteInput").value = ""; renderPalette(""); setTimeout(() => $("#paletteInput").focus(), 0);
  }
  function closePalette() { $("#paletteBackdrop").hidden = true; }
  function renderPalette(query) {
    const actions = [
      { title: "新建任务", meta: "⌘ N", icon: "i-plus", run: () => createThread() },
      { title: "选择工作区", meta: basename(state.cwd), icon: "i-folder", run: chooseWorkspace },
      { title: "切换任务脉络", meta: "⌘ ⇧ I", icon: "i-command", run: () => { state.inspectorOpen = !state.inspectorOpen; saveState(); updateLayout(); } },
      { title: "桌面设置", meta: "⌘ ,", icon: "i-settings", run: openSettings }
    ];
    const matches = [...actions, ...state.threads.map((thread) => ({ title: thread.title, meta: "历史任务", icon: "i-terminal", run: () => { state.activeThreadId = thread.id; saveState(); renderAll(); } }))].filter((item) => item.title.toLowerCase().includes(query.toLowerCase()));
    $("#paletteResults").innerHTML = `<div class="palette-group">快速操作</div>${matches.map((item, index) => `<button class="palette-item ${index === 0 ? "is-selected" : ""}" data-palette="${index}"><svg><use href="#${item.icon}"/></svg><span>${escapeHtml(item.title)}</span><small>${escapeHtml(item.meta)}</small></button>`).join("") || '<div class="context-empty">没有匹配项</div>'}`;
    $$('[data-palette]').forEach((button) => button.addEventListener("click", () => { matches[Number(button.dataset.palette)].run(); closePalette(); }));
  }
  function openSettings() { $("#settingsBackdrop").hidden = false; loadSavedProviders(); }
  function closeSettings() { $("#settingsBackdrop").hidden = true; }

  function providerModelOptions() {
    return savedProviders.flatMap((provider) => (provider.models || []).map((model) => ({
      id: model.localId,
      label: model.name || model.id,
      provider: provider.name,
      protocol: provider.protocol
    })));
  }

  function mergeProviderModels() {
    const local = providerModelOptions();
    const ids = new Set(runtimeModels.map((item) => item.id));
    for (const model of local) if (!ids.has(model.id)) runtimeModels.push(model);
    if (!runtimeModels.some((item) => item.id === state.model)) {
      state.model = "auto";
      state.modelLabel = runtimeModels[0]?.label || "自动模型";
    }
    saveState(); updateWorkspace();
  }

  async function loadSavedProviders() {
    if (!api) { renderSavedProviders(); return; }
    savedProviders = await api.listProviders();
    renderSavedProviders(); mergeProviderModels();
  }

  function renderSavedProviders() {
    const target = $("#savedProviders");
    if (!savedProviders.length) {
      target.innerHTML = '<div class="context-empty"><span>还没有第三方模型服务</span></div>';
      return;
    }
    target.innerHTML = savedProviders.map((provider) => `<div class="saved-provider"><span class="saved-provider__protocol">${provider.protocol === "anthropic" ? "ANTH" : "OAI"}</span><span><b>${escapeHtml(provider.name)}</b><small>${escapeHtml(provider.baseUrl)} · ${provider.models.length} 个模型${provider.keyProtected ? " · 系统加密" : ""}</small></span><button class="icon-button" data-remove-provider="${provider.id}" title="移除"><svg><use href="#i-trash"/></svg></button></div>`).join("");
    $$('[data-remove-provider]').forEach((button) => button.addEventListener("click", async () => {
      savedProviders = api ? await api.removeProvider(button.dataset.removeProvider) : [];
      runtimeModels = runtimeModels.filter((item) => !String(item.id).startsWith(`desktop-${button.dataset.removeProvider.replace(/^provider-/, "provider")}`));
      renderSavedProviders(); mergeProviderModels(); await detectRuntime();
      toast("模型服务已移除", "Grok 配置已同步更新");
    }));
  }

  async function discoverProviderModels() {
    const url = $("#providerUrl").value.trim();
    const key = $("#providerKey").value.trim();
    const status = $("#providerDetectStatus");
    status.className = "provider-detect-status";
    status.textContent = "正在尝试 OpenAI 与 Anthropic 协议…";
    $("#discoverModelsButton").disabled = true;
    const result = api ? await api.discoverProviderModels({ baseUrl: url, apiKey: key }) : { ok: true, protocol: "openai", baseUrl: url, models: [{ id: "example-model", name: "Example Model" }] };
    $("#discoverModelsButton").disabled = false;
    if (!result.ok) {
      providerDiscovery = null;
      status.classList.add("is-error"); status.textContent = result.error;
      $("#discoveredModels").hidden = true; $("#providerSaveRow").hidden = true;
      return;
    }
    providerDiscovery = { ...result, apiKey: key, selected: new Set(result.models.map((model) => model.id)) };
    status.classList.add("is-success");
    status.textContent = `已识别 ${result.protocol === "anthropic" ? "Anthropic Messages" : "OpenAI Chat Completions"} 协议，共 ${result.models.length} 个模型`;
    renderDiscoveredModels();
  }

  function renderDiscoveredModels() {
    const target = $("#discoveredModels");
    if (!providerDiscovery) { target.hidden = true; return; }
    target.hidden = false;
    target.innerHTML = providerDiscovery.models.map((model) => `<label class="discovered-model"><input type="checkbox" data-discovered-model="${escapeHtml(model.id)}" ${providerDiscovery.selected.has(model.id) ? "checked" : ""}/><span><b>${escapeHtml(model.name || model.id)}</b><small>${escapeHtml(model.id)}${model.owner ? ` · ${escapeHtml(model.owner)}` : ""}</small></span></label>`).join("");
    $$('[data-discovered-model]').forEach((input) => input.addEventListener("change", () => {
      input.checked ? providerDiscovery.selected.add(input.dataset.discoveredModel) : providerDiscovery.selected.delete(input.dataset.discoveredModel);
      updateProviderSelection();
    }));
    $("#providerSaveRow").hidden = false; updateProviderSelection();
  }

  function updateProviderSelection() {
    const count = providerDiscovery?.selected.size || 0;
    $("#providerSelectionCount").textContent = `已选择 ${count} 个模型`;
    $("#saveProviderButton").disabled = count === 0;
  }

  async function saveDiscoveredProvider() {
    if (!providerDiscovery) return;
    const selected = providerDiscovery.models.filter((model) => providerDiscovery.selected.has(model.id));
    const result = api ? await api.saveProvider({
      baseUrl: providerDiscovery.baseUrl,
      apiKey: providerDiscovery.apiKey,
      protocol: providerDiscovery.protocol,
      models: selected
    }) : { ok: true, providers: [] };
    if (!result.ok) { toast("保存失败", result.error); return; }
    savedProviders = result.providers;
    providerDiscovery = null;
    $("#providerUrl").value = ""; $("#providerKey").value = "";
    $("#providerDetectStatus").className = "provider-detect-status";
    $("#providerDetectStatus").textContent = "填写连接信息后发现模型";
    $("#discoveredModels").hidden = true; $("#providerSaveRow").hidden = true;
    renderSavedProviders(); await detectRuntime(); mergeProviderModels();
    toast("第三方模型已保存", `${selected.length} 个模型已加入模型选择器`);
  }

  function closePicker() {
    pickerPopover?.remove();
    pickerPopover = null;
    $$(".is-picker-open").forEach((button) => button.classList.remove("is-picker-open"));
  }

  function openPicker(anchor, { eyebrow, title, items, selected, onSelect }) {
    closePicker();
    anchor.classList.add("is-picker-open");
    const popover = document.createElement("section");
    popover.className = "picker-popover";
    popover.setAttribute("role", "listbox");
    popover.innerHTML = `<header><small>${escapeHtml(eyebrow)}</small><b>${escapeHtml(title)}</b></header><div class="picker-popover__items">${items.map((item) => `<button class="picker-option ${item.id === selected ? "is-selected" : ""}" role="option" aria-selected="${item.id === selected}" data-picker-id="${escapeHtml(item.id)}"><span class="picker-option__radio"><i></i></span><span class="picker-option__copy"><b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.description || "")}</small></span>${item.badge ? `<em>${escapeHtml(item.badge)}</em>` : ""}</button>`).join("")}</div>`;
    document.body.appendChild(popover);
    pickerPopover = popover;
    const anchorRect = anchor.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const left = Math.max(10, Math.min(anchorRect.left, innerWidth - popoverRect.width - 10));
    const top = Math.max(10, anchorRect.top - popoverRect.height - 9);
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    popover.querySelectorAll("[data-picker-id]").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      const item = items.find((candidate) => candidate.id === button.dataset.pickerId);
      if (item) onSelect(item);
      closePicker();
    }));
  }

  function toast(title, detail) {
    const node = document.createElement("div"); node.className = "toast";
    node.innerHTML = `<svg><use href="#i-check"/></svg><span><b>${escapeHtml(title)}</b><small>${escapeHtml(detail)}</small></span>`;
    $("#toastStack").appendChild(node); setTimeout(() => node.remove(), 3600);
  }

  async function detectRuntime() {
    const orb = $(".runtime-orb");
    if (!api) { orb.classList.add("is-online"); $("#runtimeTitle").textContent = "界面预览模式"; $("#runtimeMeta").textContent = "Electron 启动后连接 Grok"; return; }
    const info = await api.runtimeInfo();
    runtimeModels = [
      { id: "auto", label: info.defaultModel ? `自动 · ${info.defaultModel}` : "自动模型" },
      ...(info.models || []).map((id) => ({ id, label: id }))
    ];
    mergeProviderModels();
    if (!runtimeModels.some((item) => item.id === state.model)) state.model = "auto";
    state.modelLabel = runtimeModels.find((item) => item.id === state.model)?.label || runtimeModels[0].label;
    saveState();
    updateWorkspace();
    orb.classList.toggle("is-online", info.connected);
    $("#runtimeTitle").textContent = info.connected ? "Grok runtime 在线" : "未检测到 Grok runtime";
    $("#runtimeMeta").textContent = info.version || "设置 GROK_BINARY 后重试";
    $("#settingsRuntimePath").textContent = info.binary || "未检测到";
  }

  function bindStaticActions() {
    $("#newThreadButton").addEventListener("click", () => createThread());
    $("#searchButton").addEventListener("click", openPalette);
    $("#brandButton").addEventListener("click", () => { state.activeThreadId = null; saveState(); renderAll(); });
    $("#workspaceButton").addEventListener("click", chooseWorkspace); $("#cwdButton").addEventListener("click", chooseWorkspace);
    $("#attachButton").addEventListener("click", chooseFiles);
    $("#sendButton").addEventListener("click", sendPrompt);
    $("#promptInput").addEventListener("input", autoSizeInput);
    $("#promptInput").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendPrompt(); } });
    $("#sidebarToggle").addEventListener("click", () => { state.sidebarHidden = !state.sidebarHidden; saveState(); updateLayout(); });
    $("#inspectorToggle").addEventListener("click", () => { state.inspectorOpen = !state.inspectorOpen; saveState(); updateLayout(); if (state.inspectorOpen) refreshActiveDockPane(); });
    $("#inspectorClose").addEventListener("click", () => { state.inspectorOpen = false; saveState(); updateLayout(); });
    $("#dockTabAdd").addEventListener("click", (event) => { event.stopPropagation(); $("#dockTabPicker").hidden = !$("#dockTabPicker").hidden; });
    $("#reviewRefresh").addEventListener("click", refreshReview);
    $("#filesRefresh").addEventListener("click", refreshWorkspaceFiles);
    $("#terminalForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = $("#terminalCommand"); const command = input.value.trim(); if (!command) return;
      const output = $("#terminalOutput");
      output.insertAdjacentHTML("beforeend", `<div class="terminal-command-line">› ${escapeHtml(command)}</div>`);
      input.value = ""; output.scrollTop = output.scrollHeight;
      if (!api) { output.insertAdjacentHTML("beforeend", '<div>桌面模式下执行本地命令。</div>'); return; }
      const result = await api.runTerminalCommand(state.cwd, command);
      if (!result.ok) output.insertAdjacentHTML("beforeend", `<div class="terminal-error">${escapeHtml(result.error)}</div>`);
      else {
        if (result.stdout) output.insertAdjacentHTML("beforeend", `<div>${escapeHtml(result.stdout)}</div>`);
        if (result.stderr) output.insertAdjacentHTML("beforeend", `<div class="terminal-error">${escapeHtml(result.stderr)}</div>`);
        output.insertAdjacentHTML("beforeend", `<div class="terminal-prompt">exit ${result.code}</div>`);
      }
      output.scrollTop = output.scrollHeight;
    });
    $("#browserForm").addEventListener("submit", (event) => {
      event.preventDefault(); let url = $("#browserUrl").value.trim();
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
      $("#browserUrl").value = url;
      const view = $("#browserView"); if (typeof view.loadURL === "function") view.loadURL(url); else view.src = url;
    });
    $("#browserExternal").addEventListener("click", () => api?.openExternal($("#browserUrl").value));
    $("#approvalSwitch").addEventListener("click", toggleApproval); $("#settingsApproval").addEventListener("click", toggleApproval);
    $("#settingsButton").addEventListener("click", openSettings); $$('[data-close-modal]').forEach((button) => button.addEventListener("click", closeSettings));
    $("#settingsBackdrop").addEventListener("click", (event) => { if (event.target === $("#settingsBackdrop")) closeSettings(); });
    $("#paletteBackdrop").addEventListener("click", (event) => { if (event.target === $("#paletteBackdrop")) closePalette(); });
    $("#paletteInput").addEventListener("input", (event) => renderPalette(event.target.value));
    $("#themeButton").addEventListener("click", () => { state.theme = resolvedTheme() === "dark" ? "light" : "dark"; saveState(); updateLayout(); });
    $("#themeSelect").addEventListener("change", (event) => { state.theme = event.target.value; saveState(); updateLayout(); });
    $("#refreshRuntime").addEventListener("click", detectRuntime); $("#runtimeCard").addEventListener("click", openSettings);
    $("#discoverModelsButton").addEventListener("click", discoverProviderModels);
    $("#saveProviderButton").addEventListener("click", saveDiscoveredProvider);
    $("#modelButton").addEventListener("click", (event) => {
      event.stopPropagation();
      openPicker(event.currentTarget, {
        eyebrow: "MODEL ROUTING",
        title: "选择模型",
        selected: state.model,
        items: runtimeModels.map((item, index) => ({ ...item, description: item.id === "auto" ? "跟随 Grok Runtime 的默认模型" : "固定使用这个模型处理后续任务", badge: index === 0 ? "推荐" : "" })),
        onSelect: (item) => { state.model = item.id; state.modelLabel = item.label; saveState(); updateWorkspace(); toast("模型已切换", item.label); }
      });
    });
    $("#effortButton").addEventListener("click", (event) => {
      event.stopPropagation();
      openPicker(event.currentTarget, {
        eyebrow: "REASONING EFFORT",
        title: "选择思考档位",
        selected: state.effort,
        items: [
          { id: "low", label: "低思考", description: "快速回答，适合简单修改与查询" },
          { id: "medium", label: "中思考", description: "速度与分析深度之间的平衡", badge: "均衡" },
          { id: "high", label: "高思考", description: "更深入地规划、实现并验证复杂任务" }
        ],
        onSelect: (item) => { state.effort = item.id; state.effortLabel = item.label; saveState(); updateWorkspace(); toast("思考档位已切换", item.label); }
      });
    });
    $("#clearThreadsButton").addEventListener("click", () => toast("任务已整理", "历史记录保留在本机"));
    $("#conversation").addEventListener("scroll", () => { const el = $("#conversation"); $("#scrollBottom").classList.toggle("is-visible", el.scrollHeight - el.scrollTop - el.clientHeight > 160); });
    $("#scrollBottom").addEventListener("click", scrollToBottom);
    $$('[data-window]').forEach((button) => button.addEventListener("click", () => { if (!api) return; const action = button.dataset.window; if (action === "min") api.minimize(); else if (action === "max") api.maximize(); else api.close(); }));
    document.addEventListener("keydown", (event) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "k") { event.preventDefault(); openPalette(); }
      if (mod && event.key.toLowerCase() === "n") { event.preventDefault(); createThread(); }
      if (mod && event.key === ",") { event.preventDefault(); openSettings(); }
      if (event.key === "Escape") { closePicker(); closePalette(); closeSettings(); }
    });
    document.addEventListener("click", (event) => {
      if (pickerPopover && !pickerPopover.contains(event.target)) closePicker();
      if (!event.target.closest("#dockTabPicker") && !event.target.closest("#dockTabAdd")) $("#dockTabPicker").hidden = true;
    });
    matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { if (state.theme === "system") updateLayout(); });
  }

  bindStaticActions();
  if (api) api.onRunEvent(handleRunEvent);
  renderDockTabPicker();
  renderAll();
  (async () => { await loadSavedProviders(); await detectRuntime(); refreshActiveDockPane(); })();
})();
