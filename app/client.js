"use client";

import { useEffect, useState } from "react";

const CLIENT_NAME_KEY = "client_name";

export const useClient = () => {
    const [clientName, setClientName] = useState("");
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        let name = window.localStorage.getItem(CLIENT_NAME_KEY);
        if (name) {
            setClientName(name);
        } else {
            name = prompt("Input name of this device.");
            if (name) {
                window.localStorage.setItem(CLIENT_NAME_KEY, name);
                setClientName(name);
            } else {
                setRetry(retry + 1);
            }
        }
    }, [retry])
    return clientName;
}

export const getClientName = () => {
    return window.localStorage.getItem(CLIENT_NAME_KEY);
}

export const resetClientInfo = () => {
    window.localStorage.removeItem(CLIENT_NAME_KEY);
}