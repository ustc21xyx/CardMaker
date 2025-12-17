"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cardToJsonString, emptyCardV3, normalizeImportedCard, type CharacterBookEntry, type CharaCardV3 } from "@/lib/charaCard";
import { embedCardIntoPng, extractCardFromPng } from "@/lib/pngCard";
import { extractFirstJsonArray, extractFirstJsonObject, tryParseJson } from "@/lib/safeJson";
import { loadJson, saveJson } from "@/lib/storage";
import { bytesToHuman } from "@/lib/text";

type Settings = {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
};

type RefFile = {
  id: string;
  name: string;
  type: string;
  size: number;
  enabled: boolean;
  content: string;
};

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type TabKey = "core" | "greetings" | "worldbook" | "extensions" | "chat" | "export" | "settings";

const SETTINGS_KEY = "cardmaker.settings.v1";
const CARD_DRAFT_KEY = "cardmaker.cardDraft.v1";
const CHAT_KEY = "cardmaker.chat.v1";

const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const tabLabel: Record<TabKey, string> = {
  core: "基础字段",
  greetings: "问候",
  worldbook: "世界书",
  extensions: "扩展项",
  chat: "对话增量",
  export: "导入/导出",
  settings: "API 设置",
};

const buildReferenceBlock = (files: RefFile[]) => {
  const enabled = files.filter((f) => f.enabled);
  if (!enabled.length) return "";
  return enabled
    .map((f, idx) => {
      const header = `【参考资料 ${idx + 1}/${enabled.length}】${f.name} (${f.type || "unknown"}, ${f.size} bytes)`;
      return `${header}\n-----\n${f.content}\n`;
    })
    .join("\n");
};

const getChatContent = (json: unknown): string | null => {
  if (!json || typeof json !== "object") return null;
  const obj = json as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = obj.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : null;
};

const extractTag = (text: string, tagName: string): string | null => {
  const open = `<${tagName}>`;
  const close = `</${tagName}>`;
  const start = text.indexOf(open);
  if (start < 0) return null;
  const end = text.indexOf(close, start + open.length);
  if (end < 0) return null;
  return text.slice(start + open.length, end).trim();
};

const Label = ({ children }: { children: ReactNode }) => (
  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{children}</div>
);

const Help = ({ children }: { children: ReactNode }) => (
  <div className="text-xs text-zinc-500 dark:text-zinc-400">{children}</div>
);

const Button = ({
  children,
  onClick,
  disabled,
  variant = "primary",
  title,
  type = "button",
}: {
  children: string;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
  title?: string;
  type?: "button" | "submit";
}) => {
  const cls =
    variant === "primary"
      ? "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
      : variant === "danger"
        ? "bg-red-600 text-white hover:bg-red-500"
        : "bg-white text-zinc-900 ring-1 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-800 dark:hover:bg-zinc-800";

  return (
    <button
      type={type}
      title={title}
      className={`inline-flex items-center justify-center rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${cls}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
};

const TextInput = ({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) => (
  <input
    value={value}
    placeholder={placeholder}
    onChange={(e) => onChange(e.target.value)}
    className="w-full rounded-lg bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-800 dark:focus:ring-zinc-100"
  />
);

const TextArea = ({
  value,
  onChange,
  rows = 8,
  placeholder,
  readOnly,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  readOnly?: boolean;
}) => (
  <textarea
    value={value}
    placeholder={placeholder}
    rows={rows}
    readOnly={readOnly}
    onChange={(e) => onChange(e.target.value)}
    className="w-full resize-y rounded-lg bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-800 dark:focus:ring-zinc-100"
  />
);

export default function Home() {
  const [tab, setTab] = useState<TabKey>("core");
  const [settings, setSettings] = useState<Settings>(() =>
    loadJson<Settings>(SETTINGS_KEY, { baseUrl: "", apiKey: "", model: "", temperature: 0.7 }),
  );
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  const [card, setCard] = useState<CharaCardV3>(() => normalizeImportedCard(loadJson(CARD_DRAFT_KEY, emptyCardV3())));
  const [goal, setGoal] = useState("");
  const [refFiles, setRefFiles] = useState<RefFile[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [png, setPng] = useState<{ name: string; bytes: Uint8Array; url: string } | null>(null);

  const [chat, setChat] = useState<ChatMessage[]>(() =>
    loadJson<ChatMessage[]>(CHAT_KEY, [
      {
        role: "assistant",
        content:
          "你可以直接对我说“补充世界书：势力、地点、规则”“把 first_mes 改成更强钩子”等。我会用 <append_entries> / <set_fields> 的方式把改动应用到草稿。",
      },
    ]),
  );
  const [chatInput, setChatInput] = useState("");
  const [chatAutoApply, setChatAutoApply] = useState(true);

  const [worldbookBatchSize, setWorldbookBatchSize] = useState(8);
  const [worldbookAppend, setWorldbookAppend] = useState(true);

  const dragIdRef = useRef<string | null>(null);

  useEffect(() => {
    saveJson(SETTINGS_KEY, settings);
  }, [settings]);

  useEffect(() => {
    saveJson(CARD_DRAFT_KEY, card);
  }, [card]);

  useEffect(() => {
    saveJson(CHAT_KEY, chat);
  }, [chat]);

  useEffect(() => {
    return () => {
      if (png) URL.revokeObjectURL(png.url);
    };
  }, [png]);

  const referenceBlock = useMemo(() => buildReferenceBlock(refFiles), [refFiles]);

  const setCardField = (field: keyof CharaCardV3["data"], value: string) => {
    setCard((prev) => ({
      ...prev,
      data: { ...prev.data, [field]: value },
    }));
  };

  const callModels = async () => {
    setError(null);
    setNotice(null);
    if (!settings.baseUrl || !settings.apiKey) {
      setError("请先填写 baseUrl 和 apiKey");
      return;
    }
    setModelsLoading(true);
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseUrl: settings.baseUrl, apiKey: settings.apiKey }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
      const parsed = tryParseJson<{ data?: Array<{ id: string }> }>(text);
      if (!parsed.ok) throw new Error(parsed.error);
      const ids = (parsed.value.data ?? []).map((m) => m.id).filter(Boolean);
      setModels(ids);
      if (!settings.model && ids.length) setSettings((s) => ({ ...s, model: ids[0] }));
      setNotice(`已拉取模型：${ids.length} 个`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setModelsLoading(false);
    }
  };

  const callChat = async (messages: Array<{ role: "system" | "user" | "assistant"; content: string }>) => {
    if (!settings.baseUrl || !settings.apiKey || !settings.model) throw new Error("请先配置 baseUrl / apiKey / model");
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        model: settings.model,
        messages,
        temperature: settings.temperature,
      }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
    const parsed = tryParseJson<unknown>(text);
    if (!parsed.ok) throw new Error(parsed.error);
    const content = getChatContent(parsed.value);
    if (!content) throw new Error("返回格式无法解析（缺少 choices[0].message.content）");
    return content;
  };

  const systemPrompt = `你是 SillyTavern（酒馆）角色卡的写卡助手。你了解 chara_card_v3 (spec_version 3.0) 的字段与写卡习惯。请用中文写作，表达自然、有可玩性，避免空泛。`;

  const normalizeEntry = (value: unknown): CharacterBookEntry => {
    const v = value as Record<string, unknown>;
    const keys = Array.isArray(v?.keys) ? v.keys.map((x) => String(x).trim()).filter(Boolean) : [];
    const content = typeof v?.content === "string" ? v.content : "";
    const comment = typeof v?.comment === "string" ? v.comment : "";
    const enabled = typeof v?.enabled === "boolean" ? v.enabled : true;
    const position = typeof v?.position === "string" ? v.position : "before_char";
    const insertion_order = typeof v?.insertion_order === "number" ? v.insertion_order : 100;
    const constant = typeof v?.constant === "boolean" ? v.constant : true;
    const selective = typeof v?.selective === "boolean" ? v.selective : true;
    const id = typeof v?.id === "string" ? v.id : uid();
    return { id, keys, content, comment, enabled, position, insertion_order, constant, selective };
  };

  const applySetFields = (fields: Record<string, unknown>) => {
    const allowed: Array<keyof CharaCardV3["data"]> = [
      "name",
      "description",
      "personality",
      "scenario",
      "first_mes",
      "mes_example",
      "creator_notes",
      "system_prompt",
      "post_history_instructions",
    ];
    setCard((prev) => {
      const nextData = { ...prev.data };
      for (const key of allowed) {
        if (typeof fields[key] === "string") nextData[key] = fields[key] as never;
      }
      if (Array.isArray(fields.tags)) {
        nextData.tags = fields.tags.map((x) => String(x).trim()).filter(Boolean);
      }
      return { ...prev, data: nextData };
    });
  };

  const appendWorldbookEntries = (entriesRaw: unknown[]) => {
    const entries = entriesRaw.map(normalizeEntry).filter((e) => e.keys.length > 0 || e.content.trim().length > 0);
    setCard((prev) => {
      const existing = prev.data.character_book?.entries ?? [];
      const existingKeySig = new Set(existing.map((e) => (e.keys ?? []).join("|").toLowerCase()));
      const deduped = entries.filter((e) => !existingKeySig.has((e.keys ?? []).join("|").toLowerCase()));
      return {
        ...prev,
        data: {
          ...prev.data,
          character_book: {
            ...(prev.data.character_book ?? { name: "", entries: [] }),
            entries: [...existing, ...deduped],
          },
        },
      };
    });
  };

  const buildContextUser = () => {
    const cardSnapshot = cardToJsonString(card);
    return `【写卡目标】\n${goal || "(未填写)"}\n\n【当前角色卡草稿（JSON）】\n${cardSnapshot}\n\n${
      referenceBlock ? `【参考资料（按顺序）】\n${referenceBlock}` : "【参考资料】(无)"
    }\n`;
  };

  const generateField = async (field: keyof CharaCardV3["data"], instruction: string) => {
    setBusy(`正在生成：${String(field)}`);
    setError(null);
    setNotice(null);
    try {
      const content = await callChat([
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `${buildContextUser()}\n【任务】\n${instruction}\n\n要求：只输出最终文本本体，不要解释，不要代码块。`,
        },
      ]);
      setCardField(field, content.trim());
      setNotice(`已写入字段：${String(field)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const generateFullCard = async () => {
    setBusy("正在生成：整张卡");
    setError(null);
    setNotice(null);
    try {
      const content = await callChat([
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `${buildContextUser()}\n【任务】\n请直接生成一份完整的 chara_card_v3 JSON（包含 spec/spec_version 与 data）。\n要求：只输出 JSON，不要代码块，不要解释。`,
        },
      ]);
      const jsonText = extractFirstJsonObject(content) ?? content.trim();
      const parsed = tryParseJson<unknown>(jsonText);
      if (!parsed.ok) throw new Error(`JSON 解析失败：${parsed.error}`);
      setCard(normalizeImportedCard(parsed.value));
      setNotice("已用模型输出覆盖当前草稿");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const generateFullCardPlaceholder = async () => {
    setBusy("正在生成：占位整卡");
    setError(null);
    setNotice(null);
    try {
      const content = await callChat([
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `${buildContextUser()}\n【任务】\n请生成一份“占位版”的 chara_card_v3 JSON（包含 spec/spec_version 与 data）。\n要求：\n- 可玩性优先，但整体尽量短\n- worldbook（character_book.entries）只输出 ${Math.max(1, Math.min(30, worldbookBatchSize))} 条以内：每条 keys 要具体；content 用“（待补充：...）”占位，comment 写明用途\n- description/personality/scenario/first_mes/mes_example 可以用“（待补充）/大纲式要点”占位，避免写长\n输出格式：只输出 JSON，不要代码块，不要解释。`,
        },
      ]);
      const jsonText = extractFirstJsonObject(content) ?? content.trim();
      const parsed = tryParseJson<unknown>(jsonText);
      if (!parsed.ok) throw new Error(`JSON 解析失败：${parsed.error}`);
      setCard(normalizeImportedCard(parsed.value));
      setNotice("已生成占位整卡（后续可分字段/对话增量完善）");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const generateWorldbook = async () => {
    setBusy(worldbookAppend ? "正在生成：世界书条目（追加）" : "正在生成：世界书条目（覆盖）");
    setError(null);
    setNotice(null);
    try {
      const existingKeys = (card.data.character_book?.entries ?? [])
        .flatMap((e) => e.keys ?? [])
        .map((k) => k.trim())
        .filter(Boolean)
        .slice(0, 200);
      const content = await callChat([
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `${buildContextUser()}\n【任务】\n请为该角色生成酒馆 worldbook（character_book.entries）。\n要求：本次只生成 ${Math.max(1, Math.min(30, worldbookBatchSize))} 条；尽量不重复已有 keys（已有 keys：${existingKeys.join("、") || "无"}）。\n输出要求：只输出 JSON 数组，每个元素包含 keys(字符串数组)、content(字符串)、comment(字符串，可空)、enabled(boolean)、position(\"before_char\")、insertion_order(数字)、constant(boolean)、selective(boolean)。\n不要代码块，不要解释。`,
        },
      ]);
      const jsonText = extractFirstJsonArray(content) ?? content.trim();
      const parsed = tryParseJson<unknown>(jsonText);
      if (!parsed.ok) throw new Error(`JSON 解析失败：${parsed.error}`);
      if (!Array.isArray(parsed.value)) throw new Error("模型没有输出 JSON 数组");
      const entries = (parsed.value as unknown[]).map(normalizeEntry);
      if (worldbookAppend) {
        appendWorldbookEntries(entries);
        setNotice(`已追加 worldbook entries（本次 ${entries.length} 条）`);
      } else {
        setCard((prev) => ({
          ...prev,
          data: {
            ...prev.data,
            character_book: {
              ...(prev.data.character_book ?? { name: "", entries: [] }),
              entries: entries.filter((e) => e.keys.length > 0 || e.content.trim().length > 0),
            },
          },
        }));
        setNotice(`已覆盖 worldbook entries（${entries.length} 条）`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const sendChat = async () => {
    const text = chatInput.trim();
    if (!text) return;
    setChatInput("");
    setError(null);
    setNotice(null);

    const protocol = `当你需要让我自动更新草稿时，请使用以下标签输出结构化 JSON（可以同时出现多个标签；标签外可以有简短说明）：\n- <set_fields>{...}</set_fields>：更新角色卡 data 字段（name/description/personality/scenario/first_mes/mes_example/creator_notes/system_prompt/post_history_instructions/tags）\n- <append_entries>[...]</append_entries>：追加 worldbook entries（数组元素包含 keys/content/comment/enabled/position/insertion_order/constant/selective）\n要求：JSON 必须可解析，禁止代码块。`;

    const currentWorldbookSummary = (card.data.character_book?.entries ?? [])
      .slice(0, 30)
      .map((e, i) => `${i + 1}. ${(e.keys ?? []).join(" / ")} :: ${(e.comment ?? "").slice(0, 30)}`)
      .join("\n");

    const messages: ChatMessage[] = [
      { role: "system", content: `${systemPrompt}\n\n${protocol}` },
      {
        role: "user",
        content: `${buildContextUser()}\n【当前世界书条目摘要（前 30 条）】\n${currentWorldbookSummary || "(无)"}\n\n【对话指令】\n${text}`,
      },
    ];

    setBusy("正在对话…");
    try {
      const reply = await callChat(messages);
      setChat((prev) => [...prev, { role: "user", content: text }, { role: "assistant", content: reply }]);

      if (!chatAutoApply) return;
      const setFieldsText = extractTag(reply, "set_fields");
      if (setFieldsText) {
        const parsed = tryParseJson<Record<string, unknown>>(setFieldsText);
        if (parsed.ok) applySetFields(parsed.value);
        else setError(`set_fields JSON 解析失败：${parsed.error}`);
      }
      const appendEntriesText = extractTag(reply, "append_entries");
      if (appendEntriesText) {
        const parsed = tryParseJson<unknown>(appendEntriesText);
        if (parsed.ok && Array.isArray(parsed.value)) appendWorldbookEntries(parsed.value as unknown[]);
        else if (parsed.ok) setError("append_entries 不是 JSON 数组");
        else setError(`append_entries JSON 解析失败：${parsed.error}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const next: RefFile[] = [];
    for (const f of Array.from(files)) {
      const content = await f.text();
      next.push({ id: uid(), name: f.name, type: f.type, size: f.size, enabled: true, content });
    }
    setRefFiles((prev) => [...prev, ...next]);
  };

  const removeFile = (id: string) => setRefFiles((prev) => prev.filter((f) => f.id !== id));

  const moveFile = (fromId: string, toId: string) => {
    setRefFiles((prev) => {
      const fromIdx = prev.findIndex((f) => f.id === fromId);
      const toIdx = prev.findIndex((f) => f.id === toId);
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return prev;
      const copy = [...prev];
      const [item] = copy.splice(fromIdx, 1);
      copy.splice(toIdx, 0, item);
      return copy;
    });
  };

  const setPngFile = async (file: File | null) => {
    if (!file) return;
    const buf = new Uint8Array(await file.arrayBuffer());
    const url = URL.createObjectURL(file);
    setPng((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return { name: file.name, bytes: buf, url };
    });
  };

  const exportJson = () => {
    const text = cardToJsonString(card);
    const name = (card.data.name || "character").replace(/[\\/:*?"<>|]/g, "_");
    downloadBlob(new Blob([text], { type: "application/json;charset=utf-8" }), `${name}.json`);
  };

  const exportPng = () => {
    setError(null);
    setNotice(null);
    if (!png) {
      setError("请先上传一张 PNG（作为封面底图）");
      return;
    }
    try {
      const text = cardToJsonString(card);
      const out = embedCardIntoPng(png.bytes, text, { writeChara: true, writeCcv3: true });
      const name = (card.data.name || "character").replace(/[\\/:*?"<>|]/g, "_");
      const ab = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
      downloadBlob(new Blob([ab], { type: "image/png" }), `${name}.png`);
      setNotice("已导出 PNG（已写入 chara/ccv3 元数据）");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const importJsonFile = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    const parsed = tryParseJson<unknown>(text);
    if (!parsed.ok) {
      setError(`导入 JSON 失败：${parsed.error}`);
      return;
    }
    setCard(normalizeImportedCard(parsed.value));
    setNotice("已导入 JSON 到草稿");
  };

  const importPngFile = async (file: File | null) => {
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const extracted = extractCardFromPng(bytes);
    if (!extracted) {
      setError("未在 PNG 中找到 chara/ccv3 元数据");
      return;
    }
    const parsed = tryParseJson<unknown>(extracted.jsonText);
    if (!parsed.ok) {
      setError(`PNG 元数据 JSON 解析失败：${parsed.error}`);
      return;
    }
    setCard(normalizeImportedCard(parsed.value));
    await setPngFile(file);
    setNotice(`已从 PNG 导入角色卡（${extracted.keyword}）`);
  };

  const clearAll = () => {
    setCard(emptyCardV3());
    setGoal("");
    setRefFiles([]);
    setNotice("已清空草稿与资料");
    setError(null);
  };

  const tabs = (Object.keys(tabLabel) as TabKey[]).map((k) => (
    <button
      key={k}
      onClick={() => setTab(k)}
      className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        tab === k
          ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
          : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900"
      }`}
    >
      {tabLabel[k]}
    </button>
  ));

  return (
    <div className="min-h-screen bg-zinc-50 font-sans text-zinc-900 dark:bg-black dark:text-zinc-100">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold tracking-tight">CardMaker（酒馆角色卡制卡助手）</h1>
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              chara_card_v3 · 支持资料上传排序/开关 · OpenAI 兼容接口 · 导出酒馆 PNG
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void generateFullCard()} disabled={!!busy} title="让模型生成整张卡（会覆盖当前草稿）">
              生成整卡
            </Button>
            <Button onClick={() => void generateFullCardPlaceholder()} disabled={!!busy} variant="secondary" title="先生成占位版骨架，后续再分批完善">
              占位整卡
            </Button>
            <Button onClick={exportJson} variant="secondary">
              导出 JSON
            </Button>
            <Button onClick={exportPng} variant="secondary">
              导出 PNG
            </Button>
            <Button onClick={clearAll} variant="danger">
              清空
            </Button>
          </div>
        </header>

        {(notice || error || busy) && (
          <div className="rounded-xl bg-white p-3 text-sm ring-1 ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-800">
            {busy && <div className="text-zinc-700 dark:text-zinc-300">⏳ {busy}</div>}
            {notice && <div className="text-emerald-700 dark:text-emerald-300">{notice}</div>}
            {error && <div className="text-red-700 dark:text-red-300">{error}</div>}
          </div>
        )}

        <div className="rounded-xl bg-white p-3 ring-1 ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-800">
          <div className="flex flex-wrap gap-2">{tabs}</div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
          <aside className="rounded-xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-800">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label>写卡目标（给 AI 的一句话）</Label>
                <TextArea
                  value={goal}
                  onChange={setGoal}
                  rows={4}
                  placeholder="例如：写一个温柔但危险的医生姐姐，现代都市，偏心理操控，适合长对话。"
                />
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-end justify-between gap-2">
                  <div className="flex flex-col gap-1">
                    <Label>参考资料</Label>
                    <Help>支持多文件；可开关、拖动排序；按顺序完整拼接喂给模型</Help>
                  </div>
                  <label className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-white px-3 py-2 text-sm font-medium ring-1 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:ring-zinc-800 dark:hover:bg-zinc-800">
                    上传
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => void addFiles(e.target.files)}
                      accept=".txt,.md,.json,.yaml,.yml,.csv,.log,.ini,.toml,.xml,.html,.js,.ts"
                    />
                  </label>
                </div>

                <div className="flex flex-col gap-2">
                  {refFiles.length === 0 && (
                    <div className="rounded-lg border border-dashed border-zinc-300 px-3 py-4 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                      未上传资料
                    </div>
                  )}
                  {refFiles.map((f, idx) => (
                    <div
                      key={f.id}
                      draggable
                      onDragStart={() => (dragIdRef.current = f.id)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        const from = dragIdRef.current;
                        if (from) moveFile(from, f.id);
                        dragIdRef.current = null;
                      }}
                      className="flex items-start justify-between gap-2 rounded-lg bg-zinc-50 p-2 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800"
                      title="拖动可排序"
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={f.enabled}
                            onChange={(e) =>
                              setRefFiles((prev) =>
                                prev.map((x) => (x.id === f.id ? { ...x, enabled: e.target.checked } : x)),
                              )
                            }
                          />
                          <div className="min-w-0 truncate text-sm font-medium">
                            {idx + 1}. {f.name}
                          </div>
                        </div>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400">
                          {bytesToHuman(f.size)} · {f.type || "unknown"}
                        </div>
                      </div>
                      <button
                        className="rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        onClick={() => removeFile(f.id)}
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label>封面 PNG（用于导出酒馆 PNG）</Label>
                <Help>上传一张 PNG；导出时会把角色卡 JSON 写入 tEXt(chara/ccv3)</Help>
                <div className="flex items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-white px-3 py-2 text-sm font-medium ring-1 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:ring-zinc-800 dark:hover:bg-zinc-800">
                    选择 PNG
                    <input
                      type="file"
                      className="hidden"
                      accept="image/png"
                      onChange={(e) => void setPngFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                  {png && <div className="min-w-0 truncate text-sm text-zinc-600 dark:text-zinc-300">{png.name}</div>}
                </div>
                {png && (
                  <div className="overflow-hidden rounded-lg ring-1 ring-zinc-200 dark:ring-zinc-800">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={png.url} alt="cover" className="h-auto w-full" />
                  </div>
                )}
              </div>
            </div>
          </aside>

          <main className="rounded-xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-800">
            {tab === "core" && (
              <div className="flex flex-col gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label>name</Label>
                    <TextInput value={card.data.name} onChange={(v) => setCardField("name", v)} placeholder="角色名" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>tags（逗号分隔）</Label>
                    <TextInput
                      value={(card.data.tags ?? []).join(", ")}
                      onChange={(v) =>
                        setCard((prev) => ({
                          ...prev,
                          data: { ...prev.data, tags: v.split(",").map((s) => s.trim()).filter(Boolean) },
                        }))
                      }
                      placeholder="例如：现代, 姐姐, 治愈"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-end justify-between gap-2">
                    <Label>description</Label>
                    <Button
                      disabled={!!busy}
                      variant="secondary"
                      onClick={() => void generateField("description", "请写角色卡的 description：简短、抓人、包含玩法/卖点。")}
                    >
                      AI 生成
                    </Button>
                  </div>
                  <TextArea value={card.data.description} onChange={(v) => setCardField("description", v)} rows={6} />
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-end justify-between gap-2">
                    <Label>personality</Label>
                    <Button
                      disabled={!!busy}
                      variant="secondary"
                      onClick={() => void generateField("personality", "请写角色卡的 personality：性格要具体、有矛盾点、能驱动对话。")}
                    >
                      AI 生成
                    </Button>
                  </div>
                  <TextArea value={card.data.personality} onChange={(v) => setCardField("personality", v)} rows={8} />
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-end justify-between gap-2">
                    <Label>scenario</Label>
                    <Button
                      disabled={!!busy}
                      variant="secondary"
                      onClick={() => void generateField("scenario", "请写角色卡的 scenario：交代关系、场景、动机和互动边界。")}
                    >
                      AI 生成
                    </Button>
                  </div>
                  <TextArea value={card.data.scenario} onChange={(v) => setCardField("scenario", v)} rows={10} />
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-end justify-between gap-2">
                    <Label>first_mes</Label>
                    <Button
                      disabled={!!busy}
                      variant="secondary"
                      onClick={() => void generateField("first_mes", "请写角色卡的 first_mes：开场白要有动作/场景/钩子，能自然引导 {{user}} 回复。")}
                    >
                      AI 生成
                    </Button>
                  </div>
                  <TextArea value={card.data.first_mes} onChange={(v) => setCardField("first_mes", v)} rows={10} />
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-end justify-between gap-2">
                    <Label>mes_example</Label>
                    <Button
                      disabled={!!busy}
                      variant="secondary"
                      onClick={() => void generateField("mes_example", "请写角色卡的 mes_example：提供 2-4 段高质量对话示例，体现角色口吻与玩法。")}
                    >
                      AI 生成
                    </Button>
                  </div>
                  <TextArea value={card.data.mes_example} onChange={(v) => setCardField("mes_example", v)} rows={12} />
                </div>
              </div>
            )}

            {tab === "greetings" && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label>alternate_greetings（每段之间空一行）</Label>
                  <Help>可选开场白列表；SillyTavern 会随机/选择使用</Help>
                  <TextArea
                    value={(card.data.alternate_greetings ?? []).join("\n\n")}
                    rows={14}
                    onChange={(v) =>
                      setCard((prev) => ({
                        ...prev,
                        data: {
                          ...prev.data,
                          alternate_greetings: v.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean),
                        },
                      }))
                    }
                    placeholder="每段之间空一行"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!!card.data.group_only_greetings}
                    onChange={(e) => setCard((prev) => ({ ...prev, data: { ...prev.data, group_only_greetings: e.target.checked } }))}
                  />
                  <div className="text-sm text-zinc-700 dark:text-zinc-200">group_only_greetings</div>
                </div>
              </div>
            )}

            {tab === "worldbook" && (
              <div className="flex flex-col gap-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="flex flex-col gap-2">
                    <Label>生成模式</Label>
                    <div className="flex items-center gap-2 text-sm">
                      <label className="flex items-center gap-2">
                        <input type="radio" checked={worldbookAppend} onChange={() => setWorldbookAppend(true)} />
                        追加
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="radio" checked={!worldbookAppend} onChange={() => setWorldbookAppend(false)} />
                        覆盖
                      </label>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>每批条数</Label>
                    <TextInput value={String(worldbookBatchSize)} onChange={(v) => setWorldbookBatchSize(Math.max(1, Math.min(30, Number(v) || 1)))} />
                    <Help>建议 5–15；太大容易跑偏/超长</Help>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>快捷</Label>
                    <Button variant="secondary" disabled={!!busy} onClick={() => void generateWorldbook()}>
                      AI 生成条目
                    </Button>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Label>character_book.name</Label>
                  <TextInput
                    value={card.data.character_book?.name ?? ""}
                    onChange={(v) =>
                      setCard((prev) => ({
                        ...prev,
                        data: { ...prev.data, character_book: { ...(prev.data.character_book ?? { entries: [] }), name: v } },
                      }))
                    }
                    placeholder="世界书名称（可选）"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-end justify-between gap-2">
                    <Label>entries</Label>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        disabled={!!busy}
                        onClick={() =>
                          setCard((prev) => ({
                            ...prev,
                            data: {
                              ...prev.data,
                              character_book: {
                                ...(prev.data.character_book ?? { name: "", entries: [] }),
                                entries: [
                                  ...(prev.data.character_book?.entries ?? []),
                                  {
                                    id: uid(),
                                    keys: ["触发词1", "触发词2"],
                                    comment: "",
                                    content: "",
                                    enabled: true,
                                    position: "before_char",
                                    insertion_order: 100,
                                    constant: true,
                                    selective: true,
                                  },
                                ],
                              },
                            },
                          }))
                        }
                      >
                        新增条目
                      </Button>
                    </div>
                  </div>
                  <Help>每个条目包含 keys（触发词）与 content；其余字段按酒馆常用默认值</Help>
                </div>

                <div className="flex flex-col gap-3">
                  {(card.data.character_book?.entries ?? []).length === 0 && (
                    <div className="rounded-lg border border-dashed border-zinc-300 px-3 py-4 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                      暂无世界书条目
                    </div>
                  )}
                  {(card.data.character_book?.entries ?? []).map((e, idx) => (
                    <div
                      key={e.id ?? idx}
                      className="rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800"
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold">条目 {idx + 1}</div>
                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
                            <input
                              type="checkbox"
                              checked={e.enabled ?? true}
                              onChange={(ev) =>
                                setCard((prev) => ({
                                  ...prev,
                                  data: {
                                    ...prev.data,
                                    character_book: {
                                      ...(prev.data.character_book ?? { name: "", entries: [] }),
                                      entries: (prev.data.character_book?.entries ?? []).map((x, i) =>
                                        i === idx ? { ...x, enabled: ev.target.checked } : x,
                                      ),
                                    },
                                  },
                                }))
                              }
                            />
                            enabled
                          </label>
                          <button
                            className="rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                            onClick={() =>
                              setCard((prev) => ({
                                ...prev,
                                data: {
                                  ...prev.data,
                                  character_book: {
                                    ...(prev.data.character_book ?? { name: "", entries: [] }),
                                    entries: (prev.data.character_book?.entries ?? []).filter((_, i) => i !== idx),
                                  },
                                },
                              }))
                            }
                          >
                            删除
                          </button>
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="flex flex-col gap-2">
                          <Label>keys（逗号分隔）</Label>
                          <TextInput
                            value={(e.keys ?? []).join(", ")}
                            onChange={(v) => {
                              const keys = v.split(",").map((s) => s.trim()).filter(Boolean);
                              setCard((prev) => ({
                                ...prev,
                                data: {
                                  ...prev.data,
                                  character_book: {
                                    ...(prev.data.character_book ?? { name: "", entries: [] }),
                                    entries: (prev.data.character_book?.entries ?? []).map((x, i) => (i === idx ? { ...x, keys } : x)),
                                  },
                                },
                              }));
                            }}
                            placeholder="例如：世界观, 背景, 设定"
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <Label>comment</Label>
                          <TextInput
                            value={e.comment ?? ""}
                            onChange={(v) =>
                              setCard((prev) => ({
                                ...prev,
                                data: {
                                  ...prev.data,
                                  character_book: {
                                    ...(prev.data.character_book ?? { name: "", entries: [] }),
                                    entries: (prev.data.character_book?.entries ?? []).map((x, i) => (i === idx ? { ...x, comment: v } : x)),
                                  },
                                },
                              }))
                            }
                          />
                        </div>
                      </div>

                      <div className="mt-3 flex flex-col gap-2">
                        <Label>content</Label>
                        <TextArea
                          value={e.content ?? ""}
                          rows={8}
                          onChange={(v) =>
                            setCard((prev) => ({
                              ...prev,
                              data: {
                                ...prev.data,
                                character_book: {
                                  ...(prev.data.character_book ?? { name: "", entries: [] }),
                                  entries: (prev.data.character_book?.entries ?? []).map((x, i) => (i === idx ? { ...x, content: v } : x)),
                                },
                              },
                            }))
                          }
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === "extensions" && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label>extensions（JSON）</Label>
                  <Help>高级项：talkativeness、depth_prompt、regex_scripts 等都在这里</Help>
                  <TextArea
                    value={JSON.stringify(card.data.extensions ?? {}, null, 2)}
                    rows={18}
                    onChange={(v) => {
                      const parsed = tryParseJson<Record<string, unknown>>(v);
                      if (!parsed.ok) {
                        setError(`extensions JSON 无法解析：${parsed.error}`);
                        return;
                      }
                      setError(null);
                      setCard((prev) => ({ ...prev, data: { ...prev.data, extensions: parsed.value } }));
                    }}
                  />
                </div>
              </div>
            )}

            {tab === "chat" && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-col gap-1">
                    <Label>对话增量完善</Label>
                    <Help>让 AI 用 &lt;append_entries&gt; / &lt;set_fields&gt; 自动把修改应用到草稿</Help>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={chatAutoApply} onChange={(e) => setChatAutoApply(e.target.checked)} />
                      自动应用
                    </label>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setChat([
                          {
                            role: "assistant",
                            content:
                              "你可以直接对我说“补充世界书：势力、地点、规则”“把 first_mes 改成更强钩子”等。我会用 <append_entries> / <set_fields> 的方式把改动应用到草稿。",
                          },
                        ])
                      }
                    >
                      清空对话
                    </Button>
                  </div>
                </div>

                <div className="h-[420px] overflow-auto rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
                  <div className="flex flex-col gap-3">
                    {chat.map((m, i) => (
                      <div key={i} className={`rounded-lg p-2 text-sm ${m.role === "user" ? "bg-white dark:bg-zinc-950" : ""}`}>
                        <div className="mb-1 text-xs font-medium text-zinc-500">{m.role}</div>
                        <pre className="whitespace-pre-wrap break-words font-sans">{m.content}</pre>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Label>输入</Label>
                  <TextArea
                    value={chatInput}
                    onChange={setChatInput}
                    rows={4}
                    placeholder="例如：继续追加世界书 8 条，主题是【势力/地点/规则】，不要重复已有 keys；或：把 scenario 改成更强互动边界。"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void sendChat()} disabled={!!busy}>
                      发送
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={!!busy}
                      onClick={() => {
                        setChatInput("继续追加世界书 8 条，主题为【势力/地点/规则】，不要重复已有 keys；content 允许先用（待补充）占位。");
                      }}
                    >
                      追加世界书词条
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={!!busy}
                      onClick={() => {
                        setChatInput("请检查当前卡是否有明显逻辑漏洞或写卡禁忌，并用 <set_fields> 给出改进后的字段（尽量只改必要字段）。");
                      }}
                    >
                      自检并改进
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {tab === "export" && (
              <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-2">
                  <Label>导入</Label>
                  <div className="flex flex-wrap gap-2">
                    <label className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-white px-3 py-2 text-sm font-medium ring-1 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:ring-zinc-800 dark:hover:bg-zinc-800">
                      导入 JSON
                      <input
                        type="file"
                        className="hidden"
                        accept="application/json,.json"
                        onChange={(e) => void importJsonFile(e.target.files?.[0] ?? null)}
                      />
                    </label>
                    <label className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-white px-3 py-2 text-sm font-medium ring-1 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:ring-zinc-800 dark:hover:bg-zinc-800">
                      导入 PNG（含卡）
                      <input type="file" className="hidden" accept="image/png" onChange={(e) => void importPngFile(e.target.files?.[0] ?? null)} />
                    </label>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Label>导出</Label>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={exportJson} variant="secondary">
                      导出 JSON
                    </Button>
                    <Button onClick={exportPng} variant="secondary">
                      导出 PNG
                    </Button>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Label>预览（将写入 PNG 的 JSON）</Label>
                  <TextArea value={cardToJsonString(card)} onChange={() => {}} rows={18} readOnly />
                </div>
              </div>
            )}

            {tab === "settings" && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label>baseUrl</Label>
                  <TextInput
                    value={settings.baseUrl}
                    onChange={(v) => setSettings((s) => ({ ...s, baseUrl: v }))}
                    placeholder="例如：https://api.openai.com"
                  />
                  <Help>将请求转发到 {`{baseUrl}`}/v1/models 与 {`{baseUrl}`}/v1/chat/completions</Help>
                </div>

                <div className="flex flex-col gap-2">
                  <Label>apiKey</Label>
                  <TextInput value={settings.apiKey} onChange={(v) => setSettings((s) => ({ ...s, apiKey: v }))} placeholder="sk-..." />
                  <Help>只保存在你的浏览器 localStorage，并在调用时发给本站 /api 代理</Help>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label>model</Label>
                    <TextInput value={settings.model} onChange={(v) => setSettings((s) => ({ ...s, model: v }))} placeholder="例如：gpt-4.1-mini" />
                    {models.length > 0 && (
                      <select
                        className="w-full rounded-lg bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-800"
                        value={settings.model}
                        onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))}
                      >
                        {models.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>temperature</Label>
                    <TextInput
                      value={String(settings.temperature)}
                      onChange={(v) => setSettings((s) => ({ ...s, temperature: Number(v) || 0 }))}
                      placeholder="0.7"
                    />
                    <Help>建议 0.4–0.9</Help>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void callModels()} disabled={modelsLoading}>
                    {modelsLoading ? "拉取中…" : "拉取模型列表"}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setModels([]);
                      setNotice("已清空本地模型列表");
                    }}
                  >
                    清空模型列表
                  </Button>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
