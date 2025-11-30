import { NextRequest } from "next/server";

export const runtime = "nodejs";

const MAX_FILE_SIZE_BYTES =
  Number(process.env.UPLOAD_MAX_FILE_BYTES || 10 * 1024 * 1024); // 10MB default
const MAX_TEXT_LENGTH =
  Number(process.env.UPLOAD_MAX_TEXT_LENGTH || 120000); // guardrail for model context

const isPdf = (file: File) =>
  file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

const isTextLike = (file: File) =>
  file.type.startsWith("text/") ||
  [".txt", ".md", ".markdown", ".csv", ".json"].some((ext) =>
    file.name.toLowerCase().endsWith(ext)
  );

const normalizeText = (text: string) =>
  text.replace(/\u0000/g, "").replace(/\r\n/g, "\n").trim();

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return new Response(JSON.stringify({ error: "File is required" }), {
        status: 400,
      });
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return new Response(
        JSON.stringify({
          error: `File too large. Max size is ${Math.floor(MAX_FILE_SIZE_BYTES / (1024 * 1024))}MB`,
        }),
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let extractedText = "";

    if (isPdf(file)) {
      // @ts-expect-error pdf-parse has no type definitions
      const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;
      const parsed = await pdfParse(buffer);
      extractedText = parsed.text || "";
    } else if (isTextLike(file)) {
      extractedText = buffer.toString("utf-8");
    } else {
      return new Response(
        JSON.stringify({
          error: "Unsupported file type. Please upload text files or PDFs.",
        }),
        { status: 400 }
      );
    }

    extractedText = normalizeText(extractedText);
    if (!extractedText) {
      return new Response(
        JSON.stringify({
          error: "No readable text found in the uploaded file.",
        }),
        { status: 400 }
      );
    }

    let truncated = false;
    if (extractedText.length > MAX_TEXT_LENGTH) {
      extractedText = extractedText.slice(0, MAX_TEXT_LENGTH);
      truncated = true;
    }

    return Response.json({
      filename: file.name,
      mime_type: file.type || "application/octet-stream",
      size: file.size,
      text: extractedText,
      truncated,
    });
  } catch (error: any) {
    console.error("Upload processing error:", error?.message || error);
    return new Response(
      JSON.stringify({
        error: "Failed to process file. Please try again.",
      }),
      { status: 500 }
    );
  }
}
