// Client wrapper for the createFamily callable.
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export async function createFamily({ familyName, guidingLight, timezone, displayName }) {
  const call = httpsCallable(functions, "createFamily");
  const res = await call({ familyName, guidingLight, timezone, displayName });
  return res.data; // { familyId, role }
}
