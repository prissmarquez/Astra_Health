// Shared Supabase client for every page.
// The publishable key is meant for the browser: on its own it can't read
// anything, RLS decides what each signed-in user sees. NEVER put the secret key here.
const SUPABASE_URL= "https://oswgtubikjlzavaxliuv.supabase.co";   // same as SUPABASE_URL in .env
const SUPABASE_PUBLISHABLE_KEY= "sb_publishable_2bsjmdVdRpEanb76wEdzcg_cd5NHr1J";    // same as in .env
const API_URL = "http://127.0.0.1:8000";                   // our FastAPI server

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// Page each role lands on after logging in.
// Change admin's page when the admin view exists.
const ROLE_HOME = {
  crew: "principal_page.html",
  leader: "principal_page.html",
  admin: "principal_page.html",
};

// Returns the signed-in user's profile ({ id, name, role, crew_id, astronaut_code }) or null.
async function getProfile() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, name, role, crew_id, astronaut_code")
    .eq("id", session.user.id)
    .single();
  return error ? null : data;
}

// Token for calling our API: headers: { Authorization: "Bearer " + token }
async function getAccessToken() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  return session ? session.access_token : null;
}
