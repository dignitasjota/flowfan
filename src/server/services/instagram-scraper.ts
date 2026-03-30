import { join } from "path";
import { writeFile, mkdir } from "fs/promises";

export async function scrapeInstagramProfile(username: string, contactId: string): Promise<{ displayName?: string, avatarUrl?: string }> {
    try {
        const res = await fetch(`https://www.instagram.com/${username}/`);
        if (!res.ok) return {};

        const html = await res.text();

        let displayName: string | undefined;
        let avatarUrl: string | undefined;

        // "og:title" content="Name (@username) • Instagram photos and videos"
        const titleMatch = html.match(/"og:title"\s+content="([^"]+)"/i);
        if (titleMatch) {
            // It returns HTML encoded entities like &#064; for @. Let's unescape common ones or just match everything before (&#064;
            const titleContent = titleMatch[1].replace(/&#064;/g, "@");
            const match = titleContent.match(/^(.*?)\s\(@/);
            if (match && match[1]) {
                displayName = match[1].trim();
            }
        }

        // "og:image" content="https://..."
        const imageMatch = html.match(/"og:image"\s+content="([^"]+)"/i);
        if (imageMatch) {
            // Decode html entities like &amp;
            const imageUrl = imageMatch[1].replace(/&amp;/g, "&");

            const imageRes = await fetch(imageUrl);
            if (imageRes.ok) {
                const buffer = await imageRes.arrayBuffer();
                const avatarsDir = join(process.cwd(), "uploads", "avatars");
                await mkdir(avatarsDir, { recursive: true });

                const sharp = (await import("sharp")).default;
                await sharp(buffer)
                    .resize(150, 150, { fit: "cover" })
                    .webp({ quality: 80 })
                    .toFile(join(avatarsDir, `${contactId}.webp`));

                avatarUrl = `/api/avatars/${contactId}`;
            }
        }

        return { displayName, avatarUrl };
    } catch (error) {
        console.error("Failed to scrape instagram profile", error);
        return {};
    }
}
