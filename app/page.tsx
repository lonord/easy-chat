"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Button, Textarea } from "@headlessui/react";
import { useClient } from "./client";
import orderBy from "lodash.orderby";
import type { ClipboardEvent as ReactClipboardEvent, ChangeEvent } from "react";

export default function Home() {
  const clientName = useClient();
  const [isConnected, setIsConnected] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);

  const [toastText, setToastText] = useState("");
  const [toastLevel, setToastLevel] = useState<ToastLevel>(null);

  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);

  const scrollDivRef = useRef<any>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const onToastDismiss = useCallback(() => {
    setToastText("");
    setToastLevel(null);
  }, []);

  const toastOK = useCallback((text: string) => {
    setToastText(text);
    setToastLevel("OK");
  }, []);

  const toastERR = useCallback((text: string) => {
    setToastText(text);
    setToastLevel("ERR");
  }, []);

  const appendMessage = useCallback((msg: Message) => {
    if (!msg) {
      return;
    }
    setMessages((prev) => {
      if (prev.some((item) => item.id === msg.id)) {
        return prev;
      }
      return orderBy([...prev, msg], ["createAt"], ["asc"]);
    });
  }, []);

  const scrollToBottom = useCallback(() => {
    if (scrollDivRef.current) {
      scrollDivRef.current.scrollTop = scrollDivRef.current.scrollHeight;
    }
  }, []);

  const onCopy = useCallback(
    (text: string) => {
      navigator.clipboard
        .writeText(text)
        .then(() => toastOK("Copied"))
        .catch((e) => {
          const message = e instanceof Error ? e.message : String(e);
          toastERR(message);
        });
    },
    [toastOK, toastERR]
  );

  const sendTextMessage = useCallback(
    async (content: string) => {
      if (sending) {
        return;
      }
      if (!clientName) {
        toastERR("Client is not ready");
        return;
      }
      if (!content || content.length === 0) {
        toastERR("Content is empty");
        return;
      }
      setSending(true);
      try {
        const response = await fetch("/api/message", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ client: clientName, content }),
        });
        let payload: any = null;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }
        if (!response.ok) {
          const message =
            payload && payload.error
              ? payload.error
              : `Request failed with status ${response.status}`;
          throw new Error(message);
        }
        setInputText("");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toastERR(message);
      } finally {
        setSending(false);
      }
    },
    [clientName, sending, toastERR]
  );

  const uploadFiles = useCallback(
    async (input: FileList | File[] | null | undefined) => {
      if (!input || sending) {
        return;
      }
      if (!clientName) {
        toastERR("Client is not ready");
        return;
      }
      const files = Array.from(input as ArrayLike<File>).filter((file) => file instanceof File);
      if (!files.length) {
        return;
      }
      setSending(true);
      try {
        for (const file of files) {
          const formData = new FormData();
          formData.append("client", clientName);
          formData.append("content", file.name);
          formData.append("attachment", file, file.name);
          const response = await fetch("/api/message", {
            method: "POST",
            body: formData,
          });
          let payload: any = null;
          try {
            payload = await response.json();
          } catch {
            payload = null;
          }
          if (!response.ok) {
            const message =
              payload && payload.error
                ? payload.error
                : `Request failed with status ${response.status}`;
            throw new Error(message);
          }
          toastOK(`Uploaded ${file.name}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toastERR(message);
      } finally {
        setSending(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [clientName, sending, toastERR, toastOK]
  );

  const handleFileInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      void uploadFiles(event.target.files);
    },
    [uploadFiles]
  );

  const handlePaste = useCallback(
    (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(event.clipboardData?.items ?? []);
      const files = items
        .map((item) => (item.kind === "file" ? item.getAsFile() : null))
        .filter((file): file is File => !!file);
      if (!files.length) {
        return;
      }
      event.preventDefault();
      void uploadFiles(files);
    },
    [uploadFiles]
  );

  const triggerFileDialog = useCallback(() => {
    if (sending) {
      return;
    }
    fileInputRef.current?.click();
  }, [sending]);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, scrollToBottom]);

  useEffect(() => {
    if (!clientName) {
      return;
    }

    let isMounted = true;
    setIsConnected(false);

    const fetchInitial = async () => {
      try {
        const response = await fetch("/api/message");
        let payload: any = null;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }
        if (!response.ok) {
          const message =
            payload && payload.error
              ? payload.error
              : `Request failed with status ${response.status}`;
          throw new Error(message);
        }
        if (isMounted) {
          const list = Array.isArray(payload?.data) ? payload.data : [];
          setMessages(orderBy(list, ["createAt"], ["asc"]));
        }
      } catch (error) {
        if (isMounted) {
          const message = error instanceof Error ? error.message : String(error);
          toastERR(message);
        }
      }
    };

    fetchInitial();

    const es = new EventSource("/api/message/stream");
    eventSourceRef.current = es;

    es.onopen = () => {
      if (!isMounted) {
        return;
      }
      setIsConnected(true);
    };

    es.onmessage = (event) => {
      if (!event.data) {
        return;
      }
      try {
        const msg = JSON.parse(event.data);
        if (isMounted) {
          appendMessage(msg);
        }
      } catch (err) {
        console.error("[sse] invalid payload", err);
      }
    };

    es.onerror = () => {
      if (!isMounted) {
        return;
      }
      setIsConnected(false);
      if (es.readyState === EventSource.CLOSED) {
        es.close();
      }
    };

    return () => {
      isMounted = false;
      setIsConnected(false);
      es.close();
      eventSourceRef.current = null;
    };
  }, [clientName, appendMessage, toastERR]);

  return (
    <main className="flex flex-col items-center justify-between p-4 max-w-screen-lg mx-auto h-full">
      <div
        ref={scrollDivRef}
        className="flex flex-col grow shrink w-full gap-y-4 my-4 overflow-y-auto"
      >
        {messages.map((msg) => (
          <Item
            key={msg.id}
            msg={msg}
            me={msg.client === clientName}
            onCopy={() => onCopy(msg.content)}
          />
        ))}
      </div>
      <div className="w-full p-3 flex flex-col items-center outline outline-gray-200 outline-1 rounded">
        <Textarea
          className="w-full h-24 resize-none outline-none pb-2"
          disabled={sending}
          placeholder="Input content..."
          value={inputText}
          onChange={(event) => setInputText(event.target.value)}
          onPaste={handlePaste}
        />
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileInputChange}
        />
        <div className="w-full pt-2 flex">
          <div className="w-1/5 flex items-center">
            <div className="text-gray-400">Text: {inputText.length}</div>
          </div>
          <div className="grow shrink flex justify-center items-center">
            <Toast text={toastText} level={toastLevel} onDismiss={onToastDismiss} />
          </div>
          <div className="flex items-center gap-2 justify-end">
            <Button
              type="button"
              disabled={!isConnected || sending}
              aria-label="Upload attachment"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gray-200 text-gray-600 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 data-[hover]:bg-gray-300 data-[active]:bg-gray-400"
              onClick={triggerFileDialog}
            >
              <svg
                className="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M7.5 18.5 16 10a2.121 2.121 0 0 0-3-3l-7.5 7.5a3.536 3.536 0 0 0 5 5l8.5-8.5" />
              </svg>
            </Button>
            <Button
              type="button"
              disabled={!isConnected || sending}
              aria-label="Send message"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-sky-600 text-white transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 data-[hover]:bg-sky-500 data-[active]:bg-sky-700"
              onClick={() => sendTextMessage(inputText)}
            >
              <svg
                className="h-5 w-5"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M3.105 11.553a1.125 1.125 0 0 1 0-2.106l16.5-6.75a1.125 1.125 0 0 1 1.53 1.53l-6.75 16.5a1.125 1.125 0 0 1-2.106 0l-1.708-4.272a.563.563 0 0 0-.314-.314l-4.272-1.708Z" />
              </svg>
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}

function Item({ msg, me, onCopy }: { msg: Message; me?: boolean; onCopy: () => void }) {
  const hasAttachment = Boolean(msg.attachmentId);
  const mimeType = typeof msg.mimeType === "string" ? msg.mimeType : "";
  const isImage = hasAttachment && mimeType.startsWith("image/");
  const attachmentUrl = hasAttachment ? `/api/attachment/${msg.attachmentId}` : null;
  const displayName = typeof msg.content === "string" && msg.content.length
    ? msg.content
    : hasAttachment
      ? msg.attachmentId
      : "";
  const linkHref =
    attachmentUrl && !isImage ? `${attachmentUrl}?download=1` : attachmentUrl ?? "";
  const linkLabel = isImage ? "Open" : "Download";
  const sizeText = hasAttachment ? formatBytes(msg.size) : null;

  return (
    <div className={`w-full ${me ? "pl-4 md:pl-8 lg:pl-16" : "pr-4 md:pr-8 lg:pr-16"}`}>
      <div
        className={`flex flex-col w-full px-3 py-2 rounded ${
          me ? "bg-sky-100" : "bg-gray-100"
        }`}
      >
        <div className="flex items-center gap-2 text-gray-400">
          <span>{msg.client}</span>
          <span className="grow shrink" />
          {!hasAttachment ? (
            <Button
              type="button"
              aria-label="Copy message"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-gray-400 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 data-[hover]:text-gray-600 data-[active]:text-gray-700 data-[hover]:bg-white/40 data-[active]:bg-white/70"
              onClick={onCopy}
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="9" y="9" width="12" height="12" rx="2" />
                <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
              </svg>
            </Button>
          ) : null}
          <span>#{msg.id}</span>
        </div>
        <div className="text-wrap break-words">
          {hasAttachment && attachmentUrl ? (
            <div className="flex flex-col gap-2 pt-2">
              <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
                <span className="font-medium text-gray-700">{displayName}</span>
                {sizeText ? <span className="text-xs text-gray-400">{sizeText}</span> : null}
                {linkHref ? (
                  <a
                    href={linkHref}
                    className="inline-flex items-center gap-1 rounded-full border border-sky-200 px-3 py-1 text-sm text-sky-600 transition hover:bg-sky-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                    target={isImage ? "_blank" : undefined}
                    rel={isImage ? "noopener noreferrer" : undefined}
                    download={isImage ? undefined : displayName || undefined}
                  >
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="m7 10 5 5 5-5" />
                      <path d="M12 15V3" />
                      <path d="M4 21h16" />
                    </svg>
                    <span>{linkLabel}</span>
                  </a>
                ) : null}
              </div>
              {isImage ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={attachmentUrl}
                    alt={displayName || "Image attachment"}
                    className="max-h-64 rounded border border-gray-200 object-contain"
                    loading="lazy"
                  />
                </>
              ) : null}
            </div>
          ) : (
            msg.content
          )}
        </div>
      </div>
    </div>
  );
}

type Message = {
  id: any;
  createAt: number;
  client: string;
  content: string;
  attachmentId?: string;
  mimeType?: string;
  size?: number;
};

function formatBytes(size?: number): string | null {
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) {
    return null;
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  const digits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function Toast({
  text,
  level,
  onDismiss,
}: {
  text: string;
  level: ToastLevel;
  onDismiss: () => void;
}) {
  const [opacity, setOpacity] = useState(0);
  const [innerText, setInnerText] = useState("");
  const [innerLevel, setInnerLevel] = useState<ToastLevel>(null);

  useEffect(() => {
    let disappearTimerId: any = null;
    let autoHideTimerId: any = null;
    if (text) {
      setOpacity(1);
      setInnerText(text);
      setInnerLevel(level);
      autoHideTimerId = setTimeout(() => {
        onDismiss();
        autoHideTimerId = null;
      }, 2000);
    } else {
      setOpacity(0);
      disappearTimerId = setTimeout(() => {
        setInnerText("");
        setInnerLevel(null);
        disappearTimerId = null;
      }, 1000);
    }
    return () => {
      if (disappearTimerId) {
        clearTimeout(disappearTimerId);
        setInnerText("");
        setInnerLevel(null);
      }
      if (autoHideTimerId) {
        clearTimeout(autoHideTimerId);
      }
    };
  }, [text, level, onDismiss]);

  let fontStyle;
  let textPrefix;
  switch (innerLevel) {
    case "OK":
      fontStyle = "text-gray-600";
      textPrefix = "✓ ";
      break;
    case "ERR":
      fontStyle = "text-red-600";
      textPrefix = "✕ ";
      break;
    default:
      fontStyle = "";
      textPrefix = "";
      break;
  }
  return (
    <div style={{ opacity: opacity }} className={`text-sm transition-opacity ${fontStyle}`}>
      {innerText ? textPrefix + innerText : ""}
    </div>
  );
}

type ToastLevel = "OK" | "ERR" | null;
