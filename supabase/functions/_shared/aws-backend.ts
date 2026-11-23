import { AuthError, createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.98.0";
import {
  verifyCognitoJwt,
  type CognitoVerifyOptions,
  type VerifiedCognitoUser,
} from "./cognito-jwt.ts";

export { verifyCognitoJwt, type CognitoVerifyOptions, type VerifiedCognitoUser };

export interface AwsS3RuntimeConfig {
  bucket: string;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  migrationToken?: string;
  migrationExpires?: number;
  nativeOnly: boolean;
}

export async function resolveAwsS3Config(
  db: SupabaseClient,
  envGet: (name: string) => string | undefined = (k) =>
    typeof Deno !== "undefined" ? Deno.env.get(k) : process.env[k],
): Promise<AwsS3RuntimeConfig> {
  const envBucket = envGet("AWS_S3_BUCKET");
  const envRegion = envGet("AWS_REGION") || envGet("AWS_DEFAULT_REGION") || "us-east-2";
  if (envBucket) {
    return {
      bucket: envBucket,
      region: envRegion,
      accessKeyId: envGet("AWS_ACCESS_KEY_ID"),
      secretAccessKey: envGet("AWS_SECRET_ACCESS_KEY"),
      sessionToken: envGet("AWS_SESSION_TOKEN"),
      nativeOnly: envGet("AWS_S3_NATIVE_ONLY") !== "false",
    };
  }

  const { data, error } = await db.rpc("aws_storage_config");
  if (error || !data?.bucket || data.region !== "us-east-2") {
    throw new Error("storage_not_configured");
  }
  return {
    ...data,
    nativeOnly: Boolean(data.nativeOnly) || envGet("AWS_S3_NATIVE_ONLY") === "true",
  };
}

export function createBackendClient(
  envGet: (name: string) => string | undefined = (k) =>
    typeof Deno !== "undefined" ? Deno.env.get(k) : process.env[k],
): SupabaseClient {
  if (typeof (globalThis as any).__AVANCA_CREATE_BACKEND_CLIENT__ === "function") {
    return (globalThis as any).__AVANCA_CREATE_BACKEND_CLIENT__();
  }
  const apiUrl = envGet("AWS_API_URL") || envGet("SUPABASE_URL")!;
  const serviceKey = envGet("AWS_SERVICE_ROLE_KEY") || envGet("SUPABASE_SERVICE_ROLE_KEY")!;
  const client = createClient(apiUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const userPoolId = envGet("AWS_COGNITO_USER_POOL_ID") || envGet("COGNITO_USER_POOL_ID");
  const region = envGet("AWS_REGION") || envGet("COGNITO_REGION") || "us-east-2";
  const clientId = envGet("AWS_COGNITO_CLIENT_ID") || envGet("COGNITO_CLIENT_ID");

  if (userPoolId) {
    client.auth.getUser = (async (jwt?: string) => {
      if (!jwt) {
        return { data: { user: null }, error: new AuthError("missing_token", 401) };
      }
      const verified = await verifyCognitoJwt(jwt, { region, userPoolId, clientId }).catch(() => null);
      if (!verified) {
        return { data: { user: null }, error: new AuthError("invalid_token", 401) };
      }
      return {
        data: {
          user: {
            id: verified.id,
            email: verified.email,
            aud: "authenticated",
            role: "authenticated",
            app_metadata: { provider: "cognito", cognito_sub: verified.cognitoSub },
            user_metadata: verified.displayName ? { display_name: verified.displayName } : {},
            created_at: new Date().toISOString(),
          } as any,
        },
        error: null,
      };
    }) as typeof client.auth.getUser;
  }

  return client;
}
