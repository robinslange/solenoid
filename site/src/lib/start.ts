export const SCOPE = 'support-bot'
export const INIT = `npx @solenoid.systems/cli init ${SCOPE}`
export const UPGRADE = 'npx @solenoid.systems/cli upgrade'
export const PER_ORDER = `npx @solenoid.systems/cli limit ${SCOPE} refunds=1 --per child`
export const STOP = `npx @solenoid.systems/cli limit ${SCOPE} refunds=0`
export const AGENT_PROMPT = `Read https://solenoid.systems/llms.txt and add Solenoid to this project. I already ran init: the spend key for the scope ${SCOPE} is in .env as SOLENOID_KEY. Before every refund the support bot issues, call spend at ${SCOPE}/<order id> with { refunds: 1 }, and before every email it sends, call spend at ${SCOPE}/<customer id> with { emails: 1 }. Don't catch spend's error around the refund or the send: let it stop the action. Then tell me which npx @solenoid.systems/cli limit commands to run, each with --per child so every order and every customer gets its own count.`
