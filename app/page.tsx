"use client";

import { useEffect, useState, useRef } from "react";
import { Button, Textarea } from '@headlessui/react'
import { socket } from "./socket";
import { useClient } from "./client";
import orderBy from "lodash.orderby";

export default function Home() {
  const clientName = useClient();
  const [isConnected, setIsConnected] = useState(false);

  const [messages, setMessages] = useState<Message[]>([])
  const [receivingMessage, setReceivingMessage] = useState(null);

  const [toastText, setToastText] = useState("");
  const [toastLevel, setToastLevel] = useState<ToastLevel>(null);

  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);

  const scrollDivRef = useRef<any>(null);

  const onToastDismiss = () => {
    setToastText("");
    setToastLevel(null);
  }

  const toastOK = (text: string) => {
    setToastText(text);
    setToastLevel("OK");
  }
  const toastERR = (text: string) => {
    setToastText(text);
    setToastLevel("ERR");
  }

  const appendMessage = (msg: Message) => {
    const mList = [...messages];
    mList.push(msg);
    setMessages(orderBy(mList, ["createAt"], ["asc"]));
  }

  const scrollToBottom = () => {
    if (scrollDivRef.current) {
      scrollDivRef.current.scrollTop = scrollDivRef.current.scrollHeight;
    }
  };

  const onCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => toastOK("Copied")).catch((e) => toastERR(e));
  }

  const sendMsg = (content: string) => {
    setSending(true);
    socket.emit("msg_push", { content }, (msg: Message, err: string) => {
      setSending(false);
      if (err) {
        toastERR(err);
      } else {
        setInputText("");
        appendMessage(msg);
      }
    })
  };

  useEffect(() => {
    if (receivingMessage) {
      appendMessage(receivingMessage);
      setReceivingMessage(null);
    }
  }, [receivingMessage])

  useEffect(() => {
    if (socket.connected) {
      onConnect();
    }

    function onConnect() {
      if (!clientName) {
        return;
      }

      setIsConnected(true);

      socket.emit("info", { name: clientName }, () => {
        socket.emit("msg_sync", {}, setMessages)
      })
    }

    function onDisconnect() {
      setIsConnected(false);
    }

    socket.on("msg_update", setReceivingMessage);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    return () => {
      socket.off("msg_update", setReceivingMessage);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, [clientName]);

  useEffect(scrollToBottom, [messages.length])

  return (
    <main className="flex flex-col items-center justify-between p-4 max-w-screen-lg mx-auto h-full">
      <div ref={scrollDivRef} className="flex flex-col grow shrink w-full gap-y-4 my-4 overflow-y-auto">
        {messages.map(msg => (
          <Item key={msg.id} msg={msg} me={msg.client === clientName} onClick={() => onCopy(msg.content)} />
        ))}
      </div>
      <div className="w-full p-2 flex flex-col items-center outline outline-gray-200 outline-1 rounded">
        <Textarea className="w-full h-24 resize-none outline-none px-2" disabled={sending}
          placeholder="Input content..." value={inputText} onChange={(event) => setInputText(event.target.value)} />
        <div className="w-full pt-2 flex">
          <div className="w-1/5">
            <div className="text-gray-400">Text: {inputText.length}</div>
          </div>
          <div className="grow shrink flex justify-center items-center">
            <Toast text={toastText} level={toastLevel} onDismiss={onToastDismiss} />
          </div>
          <div className="w-1/5 flex justify-end">
            <Button disabled={!isConnected || sending}
              className="rounded bg-sky-600 py-2 px-4 text-sm text-white data-[hover]:bg-sky-500 data-[active]:bg-sky-700 ml-4"
              onClick={() => sendMsg(inputText)}>Send</Button>
          </div>
        </div>
      </div>
    </main>
  );
}

function Item({ msg, me, onClick }: { msg: Message, me?: boolean, onClick: () => void }) {
  return (
    <div className={`w-full ${me ? 'pl-4 md:pl-8 lg:pl-16' : 'pr-4 md:pr-8 lg:pr-16'}`}>
      <div className={`flex flex-col w-full px-3 py-2 cursor-pointer rounded ${me ? 'bg-sky-100' : 'bg-gray-100'}`} onClick={onClick}>
        <div className="flex text-gray-400">
          <span>{msg.client}</span>
          <span className="grow shrink" />
          <span>#{msg.id}</span>
        </div>
        <div className="text-wrap break-words">{msg.content}</div>
      </div>
    </div>
  )
}

type Message = {
  id: any
  createAt: number
  client: string
  content: string
}

function Toast({ text, level, onDismiss }: { text: string, level: ToastLevel, onDismiss: () => void }) {
  const [opacity, setOpacity] = useState(0)
  const [innerText, setInnerText] = useState("")
  const [innerLevel, setInnerLevel] = useState<ToastLevel>(null)

  useEffect(() => {
    let disappearTimerId: any = null;
    let autoHideTimerId: any = null;
    if (text) {
      setOpacity(1)
      setInnerText(text)
      setInnerLevel(level)
      autoHideTimerId = setTimeout(() => {
        onDismiss();
        autoHideTimerId = null
      }, 2000);
    } else {
      setOpacity(0)
      disappearTimerId = setTimeout(() => {
        setInnerText("")
        setInnerLevel(null)
        disappearTimerId = null
      }, 1000);
    }
    return () => {
      if (disappearTimerId) {
        clearTimeout(disappearTimerId)
        setInnerText("")
        setInnerLevel(null)
      }
    }
  }, [text, level])

  let fontStyle;
  let textPrefix;
  switch (innerLevel) {
    case "OK":
      fontStyle = "text-gray-600"
      textPrefix = "✓ "
      break;
    case "ERR":
      fontStyle = "text-red-600"
      textPrefix = "✕ "
      break;
    default:
      fontStyle = ""
      textPrefix = ""
      break;
  }
  return (
    <div style={{ opacity: opacity }} className={`text-sm transition-opacity ${fontStyle}`}> {innerText ? textPrefix + innerText : ''}</div >
  )
}

type ToastLevel = "OK" | "ERR" | null
