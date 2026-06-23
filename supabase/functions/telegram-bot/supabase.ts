import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ENV } from "./env.ts";

export const supabase = createClient(ENV.SB_URL, ENV.SB_SERVICE_ROLE);