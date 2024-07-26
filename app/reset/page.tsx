"use client";

import { useState, useEffect } from "react";
import { Button } from '@headlessui/react'
import { getClientName, resetClientInfo } from "../client";

export default function Reset() {
    const [clientName, setClientName] = useState("<Loading>");

    useEffect(() => {
        setClientName(getClientName() as string);
    }, [])

    const onReset = () => {
        resetClientInfo();
        location.reload();
    }

    return (
        <div className="flex flex-col items-center justify-between p-4 max-w-screen-lg mx-auto">
            <div className="mb-4">Client: {clientName || '<NotSet>'}</div>
            <div>
                <Button disabled={!clientName}
                    className="rounded bg-sky-600 py-2 px-4 text-sm text-white data-[hover]:bg-sky-500 data-[active]:bg-sky-700 ml-4"
                    onClick={onReset}>Reset</Button>
            </div>
        </div>
    )
}