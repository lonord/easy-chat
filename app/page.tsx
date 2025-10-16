"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Button, Textarea } from "@headlessui/react";
import { useClient } from "./client";
import orderBy from "lodash.orderby";

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

  const sendMsg = useCallback(
    async (content: string) => {
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
    [clientName, toastERR]
  );

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
            onClick={() => onCopy(msg.content)}
          />
        ))}
      </div>
      <div className="w-full p-2 flex flex-col items-center outline outline-gray-200 outline-1 rounded">
        <Textarea
          className="w-full h-24 resize-none outline-none px-2"
          disabled={sending}
          placeholder="Input content..."
          value={inputText}
          onChange={(event) => setInputText(event.target.value)}
        />
        <div className="w-full pt-2 flex">
          <div className="w-1/5">
            <div className="text-gray-400">Text: {inputText.length}</div>
          </div>
          <div className="grow shrink flex justify-center items-center">
            <Toast text={toastText} level={toastLevel} onDismiss={onToastDismiss} />
          </div>
          <div className="w-1/5 flex justify-end">
            <Button
              disabled={!isConnected || sending}
              className="rounded bg-sky-600 py-2 px-4 text-sm text-white data-[hover]:bg-sky-500 data-[active]:bg-sky-700 ml-4"
              onClick={() => sendMsg(inputText)}
            >
              Send
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}

function Item({ msg, me, onClick }: { msg: Message; me?: boolean; onClick: () => void }) {
  return (
    <div className={`w-full ${me ? "pl-4 md:pl-8 lg:pl-16" : "pr-4 md:pr-8 lg:pr-16"}`}>
      <div
        className={`flex flex-col w-full px-3 py-2 cursor-pointer rounded ${
          me ? "bg-sky-100" : "bg-gray-100"
        }`}
        onClick={onClick}
      >
        <div className="flex text-gray-400">
          <span>{msg.client}</span>
          <span className="grow shrink" />
          <span>#{msg.id}</span>
        </div>
        <div className="text-wrap break-words">{msg.content}</div>
      </div>
    </div>
  );
}

type Message = {
  id: any;
  createAt: number;
  client: string;
  content: string;
};

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
