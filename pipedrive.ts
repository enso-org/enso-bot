/** @file Functions for interacting with Pipedrive. */
import * as newtype from './newtype'

import CONFIG from './config.json' assert { type: 'json' }

/* eslint-disable @typescript-eslint/naming-convention */

export const ENABLED = 'pipedrive' in CONFIG && Boolean(CONFIG.pipedrive)
const BASE_PATH =
    'pipedrive' in CONFIG &&
    Boolean(CONFIG.pipedrive) &&
    'pipedriveCompanyDomain' in CONFIG &&
    typeof CONFIG.pipedriveCompanyDomain === 'string'
        ? `https://${CONFIG.pipedriveCompanyDomain}.pipedrive.com/api`
        : ''
const API_TOKEN =
    'pipedriveApiToken' in CONFIG && typeof CONFIG.pipedriveApiToken === 'string'
        ? CONFIG.pipedriveApiToken
        : ''

async function post<T>(path: string, body: object): Promise<FailureResponse | T> {
    if (!ENABLED) {
        throw new Error('Pipedrive is not enabled.')
    } else {
        const response = await fetch(
            `${BASE_PATH}${path}?${new URLSearchParams({ api_token: API_TOKEN }).toString()}`,
            {
                method: 'POST',
                body: JSON.stringify(body),
                headers: [['Content-Type', 'application/json']],
            }
        )
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return await response.json()
    }
}

async function get<T>(path: string, query: object): Promise<FailureResponse | T> {
    if (!ENABLED) {
        throw new Error('Pipedrive is not enabled.')
    } else {
        const response = await fetch(
            // This is UNSAFE at the type level, but the runtime handles it fine.
            // eslint-disable-next-line no-restricted-syntax
            `${BASE_PATH}${path}?${new URLSearchParams({ ...query, api_token: API_TOKEN } as Record<
                string,
                string
            >).toString()}`
        )
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return await response.json()
    }
}

export enum Visibility {
    OwnerOnly = 1,
    OwnersVisibilityGroup = 3,
    OwnersVisibilityGroupAndSubgroups = 5,
    EntireCompany = 7,

    // eslint-disable-next-line @typescript-eslint/no-duplicate-enum-values
    EssentialOrAdvancedPlan_OwnerAndFollowers = 1,
    // eslint-disable-next-line @typescript-eslint/no-duplicate-enum-values
    EssentialOrAdvancedPlan_EntireCompany = 3,
}

export interface User {
    id: number
}

export interface Person {
    id: number
    name: string
}

export interface Organization {
    id: number
    name: string
    address?: string | null
}

export interface EmailInfo {
    value: string
    primary?: 'false' | 'true'
    label?: string
}

export interface PhoneInfo {
    value: string
    primary?: 'false' | 'true'
    label?: string
}

export interface UserInfo {
    id: number
    name: string
    email: string
    has_pic: boolean | 0 | 1
    pic_hash: string
    active_flag: boolean
}

export interface OrganizationInfo {
    id: number
    name: string
    people_count: number
    owner_id: number
    address: string
    cc_email: string
    active_flag: boolean
}

export interface PersonInfo {
    id: number
    name: string
    active_flag: boolean
    owner_id: number
}

export interface DealInfo {
    id: number
    title: string
    status: 'deleted' | 'lost' | 'open' | 'won'
    value: number
    currency: string
    stage_id: number
    pipeline_id: number
}

export interface FailureResponse {
    success: false
    // eslint-disable-next-line @typescript-eslint/ban-types, no-restricted-syntax
    error: 'unauthorized access' | (string & {})
    // eslint-disable-next-line @typescript-eslint/ban-types, no-restricted-syntax, @typescript-eslint/no-magic-numbers
    errorCode: 401 | (number & {})
    error_info: string
}

export interface SearchLeadsRequest {
    /** The search term to look for. Minimum 2 characters (or 1 if using `exact_match`). */
    term: string
    /** The fields to perform the search from. Defaults to all of them. */
    fields?: Partial<Record<'custom_fields' | 'notes' | 'title', true>>
    /** When enabled, only full exact matches against the given term are returned.
     * It is **not** case sensitive. Defaults to `false`. */
    exact_match?: boolean
    /** Will filter leads by the provided person ID.
     * The upper limit of found leads associated with the person is 2000. */
    person_id?: number
    /** Will filter leads by the provided organization ID.
     * The upper limit of found leads associated with the organization is 2000. */
    organization_id?: number
    /** Supports including optional fields in the results which are not provided by default. */
    include_fields?: 'lead.was_seen'
    /** Pagination start. Note that the pagination is based on main results
     * and does not include related items when using the `search_for_related_items` parameter.
     * Defaults to 0. */
    start?: number
    /** Items shown per page. */
    limit?: number
}

export type Rfc3339Date = newtype.Newtype<string, 'Rfc3339Date'>

interface LeadBase {
    id: string
    title: string
    owner_id: number
    creator_id: number
    label_ids: string[]
    person_id: number | null
    organization_id: number | null
    // eslint-disable-next-line @typescript-eslint/ban-types, no-restricted-syntax
    source_name: 'API' | (string & {})
    is_archived: boolean
    was_seen: boolean
    value: unknown
    expected_close_date: string | null
    next_activity_id: number
    add_time: Rfc3339Date
    update_time: Rfc3339Date
}

interface LeadWithPerson extends LeadBase {
    person_id: number
    organization_id: null
}

interface LeadWithOrganization extends LeadBase {
    person_id: number
    organization_id: null
}

export type Lead = LeadWithOrganization | LeadWithPerson

interface PaginationDataBase {
    /** Pagination start. */
    start: number
    /** Items shown per page. */
    limit: number
    /** If there are more list items in the collection than displayed or not. */
    more_items_in_collection: boolean
}

interface PaginationDataWithoutMoreItems extends PaginationDataBase {
    /** If there are more list items in the collection than displayed or not. */
    more_items_in_collection: false
}

interface PaginationDataWithMoreItems extends PaginationDataBase {
    /** If there are more list items in the collection than displayed or not. */
    more_items_in_collection: true
    /** Pagination start for next page. Only present if `more_items_in_collection` is `true`. */
    next_start: number
}

export type PaginationData = PaginationDataWithMoreItems | PaginationDataWithoutMoreItems

/** The additional data of the list */
export interface AdditionalData {
    pagination?: PaginationData
}

export interface SearchLead {
    id: string
    type: 'lead'
    title: string
    owner: User
    person: Person
    organization: Organization
    phones: string[]
    emails: string[]
    custom_fields: object[]
    notes: string[]
    value: unknown
    currency: string
    visible_to: Visibility
}

export interface SearchLeadsResponseItem {
    result_score: number
    item: SearchLead
}

export interface SearchLeadsResponseData {
    items: SearchLeadsResponseItem[]
}

export interface SearchLeadsResponse {
    success: true
    data: SearchLeadsResponseData
    additional_data?: AdditionalData
}

export function searchLeads(body: SearchLeadsRequest) {
    return get<SearchLeadsResponse>('/v1/leads/search', {
        ...body,
        ...('fields' in body ? { fields: Object.keys(body.fields).join(',') } : {}),
    })
}

interface AddLeadRequestBase {
    /** The name of the lead */
    title: string
    /** The ID of the user which will be the owner of the created lead.
     * If not provided, the user making the request will be used. */
    owner_id?: number
    /** The IDs of the lead labels which will be associated with the lead. */
    label_ids?: number[]
    /** The potential value of the lead. */
    value?: unknown
    /** The date of when the deal which will be created from the lead is expected to be closed.
     * In ISO 8601 format: YYYY-MM-DD. */
    expected_close_date?: string
    /** The visibility of the lead. If omitted, the visibility will be set
     * to the default visibility setting of this item type for the authorized user.
     * Read more about visibility groups [here].
     *
     * [here]: https://support.pipedrive.com/en/article/visibility-groups */
    visible_to?: Visibility
    /** A flag indicating whether the lead was seen by someone in the Pipedrive UI. */
    was_seen?: boolean
}

interface AddLeadRequestWithPersonId extends AddLeadRequestBase {
    /** The ID of a person which this lead will be linked to.
     * If the person does not exist yet, it needs to be created first. */
    person_id: number
}

interface AddLeadRequestWithOrganizationId extends AddLeadRequestBase {
    /** The ID of an organization which this lead will be linked to.
     * If the organization does not exist yet, it needs to be created first. */
    organization_id: number
}

export type AddLeadRequest = AddLeadRequestWithOrganizationId | AddLeadRequestWithPersonId

export interface AddLeadResponse {
    success: true
    data: Lead
}

export function addLead(body: AddLeadRequest) {
    return post<AddLeadResponse>('/v1/leads', body)
}

export interface SearchPersonsRequest {
    /** The search term to look for. Minimum 2 characters (or 1 if using `exact_match`). */
    term: string
    /** The fields to perform the search from. Defaults to all of them.
     * Only the following custom field types are searchable:
     * `address`, `varchar`, `text`, `varchar_auto`, `double`, `monetary` and `phone`.
     * Read more about searching by custom fields [here].
     *
     * [here]: https://support.pipedrive.com/en/article/search-finding-what-you-need#searching-by-custom-fields */
    fields?: Partial<Record<'custom_fields' | 'email' | 'name' | 'notes' | 'phone', true>>
    /** When enabled, only full exact matches against the given term are returned.
     * It is **not** case sensitive. Defaults to `false`. */
    exact_match?: boolean
    /** Will filter persons by the provided organization ID.
     * The upper limit of found persons associated with the organization is 2000. */
    organization_id?: number
    /** Supports including optional fields in the results which are not provided by default */
    include_fields?: 'person.picture'
    /** Pagination start. Note that the pagination is based on main results
     * and does not include related items when using `search_for_related_items` parameter.
     * Defaults to 0. */
    start?: number
    /** Items shown per page. */
    limit?: number
}

export interface SearchPerson {
    id: number
    type: 'person'
    name: string
    phones: string[]
    emails: string[]
    visible_to: Visibility
    owner: User
    organization: Organization
    custom_fields: unknown[]
    notes: string[]
}

export interface SearchPersonsResponseItem {
    result_score: number
    item: SearchPerson
}

export interface SearchPersonsResponseData {
    items: SearchPersonsResponseItem[]
}

export interface SearchPersonsResponse {
    success: true
    data: SearchPersonsResponseData
    additional_data?: AdditionalData
}

export function searchPersons(body: SearchPersonsRequest) {
    return get<SearchPersonsResponse>('/v1/persons/search', {
        ...body,
        ...('fields' in body ? { fields: Object.keys(body.fields).join(',') } : {}),
    })
}

export enum MarketingStatus {
    NoConsent = 'no_consent',
    Unsubscribed = 'unsubscribed',
    Subscribed = 'subscribed',
    Archived = 'archived',
}

export interface AddPersonRequest {
    name: string
    /** The ID of the user who will be marked as the owner of this person.
     * When omitted, the authorized user ID will be used. */
    owner_id?: number
    /** The ID of the organization this person will belong to */
    org_id?: number
    /** An email address as a string or an array of email objects related to the person.
     * The structure of the array is as follows:
     * `[{ "value": "mail@example.com", "primary": "true", "label": "main" }]`.
     * Please note that only `value` is required. */
    email?: EmailInfo[]
    /** A phone number supplied as a string or an array of phone objects related to the person.
     * The structure of the array is as follows:
     * `[{ "value": "12345", "primary": "true", "label": "mobile" }]`.
     * Please note that only `value` is required. */
    phone?: PhoneInfo[]
    /** The ID of the label. */
    label?: number
    /** The visibility of the person. If omitted, the visibility will be set
     * to the default visibility setting of this item type for the authorized user.
     * Read more about visibility groups [here].
     *
     * [here]: https://support.pipedrive.com/en/article/visibility-groups */
    visible_to?: Visibility
    marketing_status?: MarketingStatus
    /** The optional creation date & time of the person in UTC.
     * Requires admin user API token. Format: YYYY-MM-DD HH:MM:SS */
    add_time?: string
}

export interface AddPersonResponseRelatedObjects {
    user?: Record<string, UserInfo>
}

export interface AddPersonResponseData {
    id: number
    company_id: number
    name: string
    first_name: string
    last_name: string
    open_deals_count: number
    related_open_deals_count: number
    closed_deals_count: number
    related_closed_deals_count: number
    participant_open_deals_count: number
    participant_closed_deals_count: number
    email_messages_count: number
    activities_count: number
    done_activities_count: number
    undone_activities_count: number
    files_count: number
    notes_count: number
    followers_count: number
    won_deals_count: number
    related_won_deals_count: number
    lost_deals_count: number
    related_lost_deals_count: number
    active_flag: true
    primary_email: string
    first_char: string
    update_time: string
    add_time: string
    visible_to: string
    marketing_status: string
    next_activity_date: string
    next_activity_time: string
    next_activity_id: number
    last_activity_id: number
    last_activity_date: string
    last_incoming_mail_time: string
    last_outgoing_mail_time: string
    label: number
    org_name: string
    owner_name: string
    cc_email: string
}

export interface AddPersonResponse {
    success: boolean
    data: AddPersonResponseData
    related_objects: AddPersonResponseRelatedObjects
}

export function addPerson(body: AddPersonRequest) {
    return post<AddPersonResponse>('/v1/persons', body)
}

export interface AddActivityRequest {
    /** The due date of the activity. Format: YYYY-MM-DD */
    due_date?: string
    /** The due time of the activity in UTC. Format: HH:MM */
    due_time?: string
    /** The duration of the activity. Format: HH:MM */
    duration?: string
    /** The ID of the deal this activity is associated with */
    deal_id?: number
    /** The ID of the lead in the UUID format this activity is associated with. */
    lead_id?: string
    /** The ID of the person this activity is associated with. */
    person_id?: number
    /** The ID of the project this activity is associated with. */
    project_id?: number
    /** The ID of the organization this activity is associated with. */
    org_id?: number
    /** The address of the activity.
     * Pipedrive will automatically check if the location matches a geo-location on Google Maps. */
    location?: string
    /** Additional details about the activity that is synced to your external calendar.
     * Unlike the note added to the activity,
     * the description is publicly visible to any guests added to the activity. */
    public_description?: string
    /** The note of the activity (HTML format). */
    note?: string
    /** The subject of the activity.
     * When the value for `subject` is not set, it will be given a default value `Call`. */
    subject?: string
}

export interface AddActivityResponseRelatedObjects {
    user?: Record<string, UserInfo>
    organization?: Record<string, OrganizationInfo>
    person?: Record<string, PersonInfo>
    deal?: Record<string, DealInfo>
}

export interface AddActivityResponse {
    success: true
    related_objects?: AddActivityResponseRelatedObjects
    related_data?: AdditionalData
}

export function addActivity(body: AddActivityRequest) {
    return post<AddActivityResponse>('/v1/activities', body)
}
