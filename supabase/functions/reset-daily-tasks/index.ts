import { createBackendClient } from "../_shared/aws-backend.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createBackendClient();

    // Reset all fixed daily tasks back to "todo"
    const { data, error } = await supabase
      .from("tasks")
      .update({ status: "todo", completed_at: null })
      .eq("is_fixed_daily", true)
      .eq("status", "done")
      .select("id");

    if (error) {
      console.error("Error resetting tasks:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Reset ${data?.length || 0} fixed daily tasks`);

    return new Response(
      JSON.stringify({ success: true, reset_count: data?.length || 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
