export type CharacterBookEntry = {
  id?: string;
  keys: string[];
  comment?: string;
  content: string;
  constant?: boolean;
  selective?: boolean;
  insertion_order?: number;
  enabled?: boolean;
  position?: string;
};

export type CharacterBook = {
  name?: string;
  entries: CharacterBookEntry[];
};

export type CharaCardV3Data = {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  creator_notes?: string;
  system_prompt?: string;
  post_history_instructions?: string;
  tags?: string[];
  creator?: string;
  character_version?: string;
  alternate_greetings?: string[];
  group_only_greetings?: boolean;
  character_book?: CharacterBook;
  extensions?: Record<string, unknown>;
};

export type CharaCardV3 = {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  creatorcomment?: string;
  avatar?: string;
  talkativeness?: string;
  fav?: boolean;
  tags?: string[];
  spec: "chara_card_v3";
  spec_version: "3.0";
  data: CharaCardV3Data;
  create_date?: string;
};

export const emptyCardV3 = (): CharaCardV3 => ({
  name: "",
  description: "",
  personality: "",
  scenario: "",
  first_mes: "",
  mes_example: "",
  creatorcomment: "",
  avatar: "none",
  talkativeness: "0.5",
  fav: false,
  tags: [],
  spec: "chara_card_v3",
  spec_version: "3.0",
  data: {
    name: "",
    description: "",
    personality: "",
    scenario: "",
    first_mes: "",
    mes_example: "",
    creator_notes: "",
    system_prompt: "",
    post_history_instructions: "",
    tags: [],
    creator: "",
    character_version: "",
    alternate_greetings: [],
    group_only_greetings: false,
    character_book: { name: "", entries: [] },
    extensions: {},
  },
  create_date: "",
});

export const syncTopLevelFromData = (card: CharaCardV3): CharaCardV3 => ({
  ...card,
  name: card.data.name,
  description: card.data.description,
  personality: card.data.personality,
  scenario: card.data.scenario,
  first_mes: card.data.first_mes,
  mes_example: card.data.mes_example,
  tags: card.data.tags ?? card.tags ?? [],
});

export const normalizeImportedCard = (input: unknown): CharaCardV3 => {
  if (!input || typeof input !== "object") return emptyCardV3();
  const obj = input as Partial<CharaCardV3>;
  const data = (obj.data ?? {}) as Partial<CharaCardV3Data>;

  const merged: CharaCardV3 = {
    ...emptyCardV3(),
    ...obj,
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: {
      ...emptyCardV3().data,
      ...data,
    },
  };

  merged.data.name ||= merged.name || "";
  merged.data.description ||= merged.description || "";
  merged.data.personality ||= merged.personality || "";
  merged.data.scenario ||= merged.scenario || "";
  merged.data.first_mes ||= merged.first_mes || "";
  merged.data.mes_example ||= merged.mes_example || "";
  merged.data.tags ||= merged.tags || [];

  return syncTopLevelFromData(merged);
};

export const cardToJsonString = (card: CharaCardV3): string =>
  JSON.stringify(syncTopLevelFromData(card), null, 2);

