import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Toaster } from "@/components/ui/sonner";
import { Spinner } from "@/components/ui/spinner";
import { Copy01Icon, Search01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { hc } from "hono/client";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import type { AppType } from "../../server";

const { api } = hc<AppType>("");

export const path = "/";

class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

export function Component() {
  const [searchParams, setSearchParams] = useSearchParams();

  const query = searchParams.get("q")?.trim() ?? "";

  const {
    data: emojis,
    error,
    isFetching,
  } = useQuery({
    queryKey: ["emojis", query],
    queryFn: () =>
      api.emojis.search
        .$get({ query: { query } })
        .then((res) =>
          res.ok
            ? res.json()
            : Promise.reject(
                res.status === 429
                  ? new RateLimitError("Whoa, slow down!")
                  : new Error("Something's not right. Please try again.")
              )
        ),
    enabled: !!query,
    placeholderData: keepPreviousData,
    select: (data) => data.emojis,
    retry: (failureCount, error) => (error instanceof RateLimitError ? false : failureCount < 3),
  });

  function submitAction(formData: FormData) {
    const q = formData.get("q")?.toString().trim();
    if (q) {
      setSearchParams({ q });
    }
  }

  return (
    <div className="min-h-svh flex flex-col">
      <div className="max-w-5xl mx-auto mt-36 sm:mt-60 flex-1 px-4">
        <h1 className="text-4xl md:text-6xl text-center font-medium">
          Find <span className="text-primary">emojis</span> for any context
        </h1>

        <div className="mt-16 max-w-md mx-auto flex flex-col">
          <form action={submitAction} className="w-full">
            <InputGroup className="h-12">
              <InputGroupAddon>
                <HugeiconsIcon icon={Search01Icon} className="size-5" />
              </InputGroupAddon>
              <InputGroupInput
                name="q"
                defaultValue={query}
                placeholder="cats..."
                autoComplete="off"
                className="h-10"
                autoFocus
              />
              <InputGroupAddon align="inline-end">
                {isFetching && <Spinner className="size-5" />}
              </InputGroupAddon>
            </InputGroup>
          </form>

          {error && (
            <div className="mt-6 text-center">
              <p className="text-2xl">😢</p>
              <p className="mt-2 text-red-500">{error.message}</p>
            </div>
          )}

          {!error && !!emojis?.length && (
            <div className="mt-6 grid grid-cols-6 sm:grid-cols-10 justify-items-center">
              {emojis.map((emoji, index) => (
                <EmojiButton key={`${emoji}-${index}`} emoji={emoji} />
              ))}
            </div>
          )}
        </div>
      </div>

      <Toaster position="top-center" />
    </div>
  );
}

export function EmojiButton({ emoji }: { emoji: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(emoji);
    setCopied(true);
    toast(`${emoji} was copied to your clipboard`);
    setTimeout(() => setCopied(false), 1000);
  }

  return (
    <Button variant="ghost" size="icon-lg" className="text-2xl relative group" onClick={handleCopy}>
      <span className="group-hover:opacity-0 ">{emoji}</span>
      <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100">
        {copied ? (
          <HugeiconsIcon icon={Tick02Icon} className="size-4" />
        ) : (
          <HugeiconsIcon icon={Copy01Icon} className="size-4" />
        )}
      </span>
    </Button>
  );
}
