import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(supabaseUrl, supabaseKey);

async function addCredits() {
  const { data, error } = await supabase
    .from('users')
    .update({ credits: 200 })
    .neq('iin', 'placeholder_so_it_updates_all'); // Update all users or just give a large number

  console.log(data, error);
}

addCredits();
