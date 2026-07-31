import type { Sampler, Instruction } from "./types";

export const DefaultSampler: Sampler = {
  id: "0",
  name: "Default",
  description: undefined,
  parameters: {
    temperature: 0.8,
    top_k: 40,
    repeat_penalty: 1.15,
    n_predict: 512,
    stop: [], 
    frequency_penalty: 0.0,
    presence_penalty: 0.0,
  },
  // Optional: Define a default stop pattern if your characters don't have one
  stopPattern: undefined, 
  maxTokens: 512 // Redundant with n_predict in params, but good for interface consistency if your UI reads this directly
};

export const DefaultInstruction: Instruction = {

  id: "0",
  name: "Default",
  description: undefined,
  content: "This is a conversation between a group of people."

}