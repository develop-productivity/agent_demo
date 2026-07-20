import {readFile, readdir} from 'fs/promises';
import {Tool, defineTool} from './tools/tools';
import path from 'path';
import matter from 'gray-matter';
import Type from 'typebox';


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

// read_skill tool,闭包捕获 skills
function buildReadSkillSchema(skills: Skill[]) {
    const names = skills.map(s =>s.name);
    // schema 必须在 skill 加载完成后才能构造。防止模型瞎猜
    return Type.Object({
        name:Type.String({
            description: `Skill name. One of: ${names.join(", ")}`
        })
    })
}

export function createReadSkillTool(skills: Skill[]): Tool<ReturnType<typeof buildReadSkillSchema>> {
    const byName = new Map(skills.map(s => [s.name, s]))
    return defineTool({
        name: "read_skill",
        description: "Read the full body of a skill by its name. Use this to get detailed instructions before executing a skill-related task.",
        parameters: buildReadSkillSchema(skills),
        execute: async (args) => {
            const skill = byName.get(args.name)
            if (!skill) {
                const available = skills.map(s => s.name).join(", ") || "(none)";
                return `ERROR: skill "${args.name}" not found. Available: ${available}`
            }
            return skill.body
        }
    })
}