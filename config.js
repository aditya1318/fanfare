// Supabase project the landing page registers creators with.
// Both values are on the project's Settings > API page. The anon key is public by
// design; row-level security in supabase/migrations decides what it can do.
// While url is empty the form stays in preview mode and sends nothing.
export default {
  url: '',
  anonKey: '',
};
