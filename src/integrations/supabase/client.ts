// AWS client adapter (Cognito Auth + API Gateway + RDS PostgreSQL + S3 Storage)
import { awsClient, createAwsClient } from "@/integrations/aws/client";
import type { Database } from "./types";

export type AwsClient<T = Database> = ReturnType<typeof createAwsClient<T>>;
export type SupabaseClient<T = Database> = AwsClient<T>;
export { awsClient, createAwsClient };
export const supabase = awsClient;