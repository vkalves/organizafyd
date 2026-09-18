import type { Database as GeneratedDatabase } from "./types";

type InstagramAccountTable = {
  Row: {
    id: string;
    user_id: string;
    username: string;
    email: string | null;
    phone: string | null;
    joined_at: string;
    status: "aquecimento" | "aquecida";
    observations: string | null;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id?: string;
    user_id: string;
    username: string;
    email?: string | null;
    phone?: string | null;
    joined_at?: string;
    status?: "aquecimento" | "aquecida";
    observations?: string | null;
    created_at?: string;
    updated_at?: string;
  };
  Update: {
    id?: string;
    user_id?: string;
    username?: string;
    email?: string | null;
    phone?: string | null;
    joined_at?: string;
    status?: "aquecimento" | "aquecida";
    observations?: string | null;
    created_at?: string;
    updated_at?: string;
  };
  Relationships: [];
};

type InstagramWarmupProgressTable = {
  Row: {
    id: string;
    user_id: string;
    account_id: string;
    day_number: number;
    task_index: number;
    completed: boolean;
    completed_at: string | null;
    created_at: string;
  };
  Insert: {
    id?: string;
    user_id: string;
    account_id: string;
    day_number: number;
    task_index: number;
    completed?: boolean;
    completed_at?: string | null;
    created_at?: string;
  };
  Update: {
    id?: string;
    user_id?: string;
    account_id?: string;
    day_number?: number;
    task_index?: number;
    completed?: boolean;
    completed_at?: string | null;
    created_at?: string;
  };
  Relationships: [
    {
      foreignKeyName: "instagram_warmup_progress_account_id_fkey";
      columns: ["account_id"];
      isOneToOne: false;
      referencedRelation: "instagram_accounts";
      referencedColumns: ["id"];
    },
  ];
};

type InstagramVideoTable = {
  Row: {
    id: string;
    user_id: string;
    account_id: string;
    published: boolean;
    created_at: string;
  };
  Insert: {
    id?: string;
    user_id: string;
    account_id: string;
    published?: boolean;
    created_at?: string;
  };
  Update: {
    id?: string;
    user_id?: string;
    account_id?: string;
    published?: boolean;
    created_at?: string;
  };
  Relationships: [
    {
      foreignKeyName: "instagram_videos_account_id_fkey";
      columns: ["account_id"];
      isOneToOne: false;
      referencedRelation: "instagram_accounts";
      referencedColumns: ["id"];
    },
  ];
};

type InstagramTables = {
  instagram_accounts: InstagramAccountTable;
  instagram_warmup_progress: InstagramWarmupProgressTable;
  instagram_videos: InstagramVideoTable;
};

export type AppDatabase = Omit<GeneratedDatabase, "public"> & {
  public: Omit<GeneratedDatabase["public"], "Tables"> & {
    Tables: GeneratedDatabase["public"]["Tables"] & InstagramTables;
  };
};

export type AppTableName = keyof AppDatabase["public"]["Tables"];

export type AppTableRow<Table extends AppTableName> = AppDatabase["public"]["Tables"][Table]["Row"];
export type AppTableInsert<Table extends AppTableName> = AppDatabase["public"]["Tables"][Table]["Insert"];
export type AppTableUpdate<Table extends AppTableName> = AppDatabase["public"]["Tables"][Table]["Update"];
