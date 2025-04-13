"use server";

import { streamObject } from 'ai';
import { createStreamableValue } from 'ai/rsc';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { createClient } from '@/utils/supabase/server';
import { encodedRedirect } from '@/utils/utils';
import { openai } from '@ai-sdk/openai';

interface Position {
  x: number;
  z: number;
}

interface Waypoint {
  id: number;
  name: string;
  position: Position;
  isTarget: boolean;
}

interface NPCState {
  id: number;
  personality: string;
  currentPosition: Position;
  targetWaypoint: number | null;
  conversationHistory: {
    role: 'user' | 'assistant';
    content: string;
  }[];
}

export const signUpAction = async (formData: FormData) => {
  const email = formData.get("email")?.toString();
  const password = formData.get("password")?.toString();
  const supabase = await createClient();
  const origin = (await headers()).get("origin");

  if (!email || !password) {
    return encodedRedirect(
      "error",
      "/sign-up",
      "Email and password are required",
    );
  }

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) {
    console.error(error.code + " " + error.message);
    return encodedRedirect("error", "/sign-up", error.message);
  } else {
    return encodedRedirect(
      "success",
      "/sign-up",
      "Thanks for signing up! Please check your email for a verification link.",
    );
  }
};

export const signInAction = async (formData: FormData) => {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return encodedRedirect("error", "/sign-in", error.message);
  }

  return redirect("/protected");
};

export const forgotPasswordAction = async (formData: FormData) => {
  const email = formData.get("email")?.toString();
  const supabase = await createClient();
  const origin = (await headers()).get("origin");
  const callbackUrl = formData.get("callbackUrl")?.toString();

  if (!email) {
    return encodedRedirect("error", "/forgot-password", "Email is required");
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?redirect_to=/protected/reset-password`,
  });

  if (error) {
    console.error(error.message);
    return encodedRedirect(
      "error",
      "/forgot-password",
      "Could not reset password",
    );
  }

  if (callbackUrl) {
    return redirect(callbackUrl);
  }

  return encodedRedirect(
    "success",
    "/forgot-password",
    "Check your email for a link to reset your password.",
  );
};

export const resetPasswordAction = async (formData: FormData) => {
  const supabase = await createClient();

  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  if (!password || !confirmPassword) {
    encodedRedirect(
      "error",
      "/protected/reset-password",
      "Password and confirm password are required",
    );
  }

  if (password !== confirmPassword) {
    encodedRedirect(
      "error",
      "/protected/reset-password",
      "Passwords do not match",
    );
  }

  const { error } = await supabase.auth.updateUser({
    password: password,
  });

  if (error) {
    encodedRedirect(
      "error",
      "/protected/reset-password",
      "Password update failed",
    );
  }

  encodedRedirect("success", "/protected/reset-password", "Password updated");
};

export const signOutAction = async () => {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return redirect("/sign-in");
};

export async function generate(input: string) {
  'use server';

  const stream = createStreamableValue();

  (async () => {
    const { partialObjectStream } = streamObject({
      model: openai('gpt-4-turbo'),
      system: 'You generate three notifications for a messages app.',
      prompt: input,
      schema: z.object({
        notifications: z.array(
          z.object({
            name: z.string().describe('Name of a fictional person.'),
            message: z.string().describe('Do not use emojis or links.'),
            minutesAgo: z.number(),
          }),
        ),
      }),
    });

    for await (const partialObject of partialObjectStream) {
      stream.update(partialObject);
    }

    stream.done();
  })();

  return { object: stream.value };
}

export async function processNPCInteraction(
  message: string,
  npcState: NPCState,
  waypoints: Waypoint[],
  targetWaypointId: number
) {
  'use server';

  const stream = createStreamableValue();

  // Create prompt and response details
  const targetWaypoint = waypoints.find(w => w.id === targetWaypointId);

  // Append the new user message to conversation history
  const conversationHistory = [
    ...npcState.conversationHistory,
    { role: 'user' as const, content: message }
  ];

  (async () => {
    const { partialObjectStream } = streamObject({
      model: openai('gpt-4o-mini'),
      system: `You are roleplaying as an NPC in a game called "Herding Cats". 
  
Your personality: ${npcState.personality}

Game state:
- You are currently ${npcState.targetWaypoint ? `heading to waypoint ${npcState.targetWaypoint}` : 'not moving to any waypoint'}.
- Available waypoints: ${waypoints.filter(w => !w.isTarget).map(w => `${w.id}: ${w.name}`).join(', ')}
- The TARGET waypoint is: ${targetWaypoint?.name} (ID: ${targetWaypoint?.id})
- Your current position: x=${npcState.currentPosition.x.toFixed(2)}, z=${npcState.currentPosition.z.toFixed(2)}

The player is trying to convince you to go to the TARGET waypoint. You're naturally resistant to going there.

If the player is persuasive, you might decide to go to the target waypoint, but don't make it too easy.`,
      messages: [
        ...conversationHistory.map(msg => ({
          role: msg.role,
          content: msg.content
        }))
      ],
      schema: z.object({
        thinking: z.array(z.string()).describe('Your internal thought process'),
        result: z.object({
          message: z.string().describe('Your spoken response to the player'),
          newTarget: z.number().nullable().describe('Waypoint ID to move toward, or null if not changing destination')
        })
      }),
    });

    // Stream the partial objects as they come in
    for await (const partialObject of partialObjectStream) {
      stream.update(partialObject);
    }

    stream.done();
  })();

  return {
    object: stream.value,
    conversationHistory
  };
}