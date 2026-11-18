# Barnacle CRM Requirements

Nov 16, 2026 · @Mikey

## What we want

A CRM built for Barnacle to replace Pipedrive. The core is **deals in lots of pipelines** and **email**: one-to-one email synced with Gmail, plus mass email to segments such as everyone in a pipeline.

You'll have access to my Pipedrive account to see how things work today. You'll be looking at deals and campaigns.

## Priorities;

| Area | Priority |
| --- | --- |
| Pipelines and deals | Must have |
| Contacts and organisations, with rich contact details | Must have |
| Gmail sync: read and send email inside the app | Must have |
| Mass email to segments (by pipeline, stage, field or everyone) | Must have |
| Notes and activities | Must have |
| Ambassador tracking | Must have |
| Email open and click tracking | Should have |
| Files and attachments on deals and emails | Should have |
| WhatsApp | Nice to have |
| Barnacle extras: standup view, meeting notes on deals, inbound LinkedIn leads, Claude built in, events | Nice to have |

## 1. Pipelines and deals

- Unlimited pipelines (we already have Sales, Ambassadors, Fractional CTO, Exec Dinner, one per team member, and Duncan's LinkedIn Engagers).
- Each pipeline has its own stages. Users can create, rename, reorder and delete pipelines and stages.
- Board view: one column per stage showing deal count and total value. Cards show deal title, organisation, person, value and a warning when there's no next activity. Drag cards between stages.
- List view with sorting and filters, plus a "show closed deals" option.
- Deal page: stage progress bar showing days spent in each stage, owner, followers, value, expected close date, labels, linked people and organisation, Won and Lost buttons (Lost asks for a reason).
- One timeline per deal showing everything in date order: emails, campaign emails, notes, files, activities, stage changes and WhatsApp messages.

## 2. Contacts and organisations

People need these fields:

- First and last name
- Email addresses and phone numbers (more than one of each)
- Organisation
- Role or job title
- Lead source, from an editable list (for example: Duncan's LinkedIn, referral, exec dinner, inbound, event, ambassador)
- LinkedIn profile link
- Owner and labels
- Email consent status (subscribed or unsubscribed)
- Date added and last contacted (filled in automatically)

Organisations need: name, website, sector, size, location, owner.

- Admins can add their own custom fields to people, organisations and deals.
- Duplicate detection by email address.
- Each person and organisation has the same timeline as a deal.
- Import from Pipedrive (people, organisations, deals, notes) and from CSV.

**Ambassador tracking**

- Record which ambassador referred each contact or deal.
- Each ambassador has a page showing what they've brought in and their latest updates.

## 3. One-to-one email (Gmail)

- Each user connects their own barnacle.ai Gmail account.
- Two-way sync: emails sent or received in Gmail appear in the app, and emails sent from the app appear in Gmail Sent.
- Threads link to deals, people and organisations automatically by matching email addresses, with a manual option to link or unlink.
- **Who can see email:** everyone on the team can see everyone's email conversations with a contact. The person who created a contact or deal can set it to private, which hides those conversations from everyone else.
- Compose, reply and forward from a deal or contact. Emails go from the user's own address and stay in the same thread.
- Send and receive attachments, including attaching files already saved on the deal.
- Email templates with merge fields (first name, organisation, etc.).
- Schedule send.
- Open and click tracking, switchable per email.
- An email inbox view in the app, like Pipedrive's Sales Inbox.

## 4. Mass email (campaigns)

This is the Pipedrive feature we use most: choose a pipeline and email everyone in it.

**Choosing recipients**

- Everyone in the CRM
- Everyone in a pipeline, or in a stage within a pipeline
- Filter by any field: lead source, label, organisation, owner, role, custom fields
- Save filters as reusable segments
- Unsubscribed contacts and duplicates removed automatically, with a recipient count shown before sending

**Writing the email**

- Sender name, sender email and reply-to address
- Subject and preview text, both with merge tags
- Content: build from blank with simple layouts, start from a saved template, or paste HTML
- Send a test to yourself first

**Sending and tracking**

- Send now or schedule for a set time
- Track opens, clicks, bounces and unsubscribes
- Report per campaign (totals and rates) and per recipient
- Each campaign email shows on the contact's and deal's timeline
- Replies land in the sender's normal inbox and show against the contact
- Every campaign includes an unsubscribe link, and unsubscribes are respected across all future campaigns (needed for UK GDPR and PECR)

## 5. Notes, files and activities

- Notes on deals, people and organisations, with @mentions that notify teammates.
- Upload files to deals, people and organisations; preview and download them; attach them to emails.
- Activities (calls, meetings, tasks) with due dates and times, and an Activities list showing what's due and overdue. Schedule a follow-up straight from a deal or contact. Activities sync both ways with each user's Google Calendar, and users get a reminder (email and in-app) before each one is due.

## 6. WhatsApp

- Send and receive WhatsApp messages from a deal or contact.
- Messages saved to the timeline, like emails.

## 7. Users and access

- Sign in with barnacle.ai Google accounts.
- Users today: Mikey, JD and Duncan, with room to add more.
- Admins manage pipelines, stages, custom fields and users.
- Pipelines, deals and contacts are shared across the team.

## 8. Barnacle extras (nice to have)

**Daily standup view**

- One screen per person showing what's changed since yesterday: new leads, deals that moved stage, replies received, follow-ups due or overdue.

**Meeting notes on deals**

- Claude reads our meeting notes and adds a note to each deal mentioned in the meeting.
- Action items from the meeting become follow-ups on the right deal, assigned to the right person.

**Inbound leads from LinkedIn campaigns**

- Leads from LinkedIn lead gen forms create a contact and deal automatically, tagged with the campaign they came from.
- The person responsible for the campaign (currently Mikey) gets an alert straight away.
- Automatic first email: a customisable template sent a set time after the lead arrives (for example, 2 minutes), from the responsible person's address. Can be switched on or off for each campaign.

**Account map (finding a warm way into a target company)**

- Start a board for a target company, e.g. Fitness First.
- Add the people who work there and arrange them in an org chart by role (CEO, COO, Head of Ops, site managers and so on).
- Each team member adds who they know, by hand: for example "Mikey knows Sarah, a 2nd-degree connection via Tom" or "JD worked with the CFO". Each person on the chart shows who on our team has a route to them and through whom.
- People we need to reach but have no route to yet stand out as gaps.
- People at the company who have emailed any of us appear on the chart automatically.
- Turn any person on the chart into a deal or an intro request.
- Share the map with an ambassador so they can add the people they know, and export it as a PDF or image to send on.

**Events section**

- Create events such as exec dinners and morning events, including any co-hosting business.
- Manage the invite list, RSVPs and attendance.
- Attendees link to contacts and deals, so we can see which events created new business.
