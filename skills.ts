import {readFile, readdir} from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';


export type Skill = {
    name: string;
    description: string;
    body: string,
    filePath: string
};


export async function loadSkills(dir:string) : Promise<Skill[]> {
    let files :string[];
    try {
        const entries = readdir(dir, {withFileTypes:true})
        files = (await entries).filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => path.join(dir, e.name))
    } catch (err) {
        console.warn(`[skills] cannot read dir: ${dir}`)
        return []
    }
    let skills: Skill[] = []
    const results = await Promise.all(
        files.map(async (filePath): Promise<Skill | null> => {
            try{
                const text = await readFile(filePath, 'utf-8');
                const {data, content} = matter(text)
                if (!data.name || typeof data.name !== "string") {
                    console.warn(`[skills] invalid skill file: ${filePath}, missing name`);
                    return null;
                }
                if (!data.description || typeof data.description !== "string") {
                    console.warn(`[skills] invalid skill file: ${filePath} (missing description)`);
                    return null;
                }
                if (!content.trim()) {
                    console.warn(`[skills] invalid skill file: ${filePath} (empty body)`);
                    return null;
                }
                return {
                    name: data.name,
                    description: data.description,
                    body: content,
                    filePath: filePath
                };
            } catch (err) {
                console.error(`[skills] error reading file ${filePath}:`, err);
                return null;
            }
        })
    );

    return results.filter((skill): skill is Skill => skill !== null);
}