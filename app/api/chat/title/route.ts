import { NextRequest } from "next/server";
import { client, MODEL } from "@/lib/openai";

const SYSTEM_PROMPT = `You write ultra-short chat titles (max 6 words) describing the user's intent.
- Return only the title text, no punctuation at the end.
- Use Title Case when possible.
- Do not include quotes or emojis.`;

const toTitleCase = (text: string) =>
  text
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const fallbackTitle = (prompt: string) => {
  const cleaned = prompt
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "New Chat";

  const firstSentence = cleaned.split(/[.?!]/)[0]?.trim() || cleaned;
  const words = firstSentence.split(/\s+/).slice(0, 6).join(" ");
  return toTitleCase(words || "New Chat");
};

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json();

    if (!prompt || typeof prompt !== "string") {
      return Response.json({ error: "Missing prompt" }, { status: 400 });
    }

    const userText = prompt.slice(0, 800);
    let title = "";

    try {
      const response = await client.responses.create({
        model: MODEL,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: SYSTEM_PROMPT }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: userText }],
          },
        ],
        max_output_tokens: 32,
        temperature: 0.2,
        stream: false,
      });

      const messageItems = (response.output ?? []).filter((item: any) => item.type === "message");
      title =
        messageItems
          .map((item: any) => {
            const text =
              item.output_text ||
              item.content?.[0]?.text ||
              (typeof item.content === "string" ? item.content : "");
            return typeof text === "string" ? text.trim() : "";
          })
          .find((text: string) => text.length > 0) || "";
    } catch (error) {
      console.warn("Falling back to heuristic title:", error);
    }

    if (!title) {
      title = fallbackTitle(userText);
    }

    return Response.json({ title });
  } catch (error) {
    console.error("Error generating title:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
