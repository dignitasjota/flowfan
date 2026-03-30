import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";

const UPLOADS_DIR = join(process.cwd(), "uploads", "avatars");

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const filePath = join(UPLOADS_DIR, `${id}.webp`);

    try {
        const buffer = await readFile(filePath);
        return new NextResponse(buffer, {
            headers: {
                "Content-Type": "image/webp",
                "Content-Length": String(buffer.length),
                "Cache-Control": "public, max-age=86400",
            },
        });
    } catch {
        return NextResponse.json({ error: "Avatar no encontrado" }, { status: 404 });
    }
}
