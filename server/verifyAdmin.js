import "dotenv/config";
import { getAuth } from "firebase-admin/auth";
import { db } from "./config/firebase.js";

async function verifyAdmin() {
  try {
    const email = "sarbikchakraborty92@gmail.com";

    const user = await getAuth().getUserByEmail(email);

    await getAuth().updateUser(user.uid, {
      emailVerified: true
    });

    console.log("=================================");
    console.log("Admin email verified successfully");
    console.log("Email:", email);
    console.log("UID:", user.uid);
    console.log("=================================");

    process.exit(0);

  } catch (error) {
    console.error("Failed to verify admin:", error);
    process.exit(1);
  }
}

verifyAdmin();