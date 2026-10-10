import { v4 as uuidv4 } from 'uuid';

export const localAddress = `http://${import.meta.env.VITE_HOST_IP}`

export const localPort = "8448"

export const localURL = `${localAddress}:${localPort}`

export const clientId = uuidv4()