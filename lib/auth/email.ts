// One email rule for login and account creation (trim + lowercase before validating).
import * as z from "zod";

export const Email = z.string().trim().toLowerCase().pipe(z.email());
