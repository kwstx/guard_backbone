# Dashboard Backend Integration Guide

## Step 1: Extend the FastAPI Gateway

The first step is to expand the existing backend gateway to serve the additional data required by the dashboard. Currently, the gateway only exposes a limited set of core endpoints. You will need to open the main application file and add new routes that interact with the underlying security core. These new routes should retrieve data such as the full list of registered agents, current economic balances for the budget layer, active policy rules from the enforcement engine, and aggregated analytics for the reporting section. Each endpoint will act as a bridge, querying the internal state store and returning structured data that the dashboard can consume.

## Step 2: Implement Real-Time Communication

Relying on intervals to repeatedly poll the server for new audit logs is inefficient for a system handling real-time agent decisions. The next step is to upgrade the communication protocol between the dashboard and the gateway. You should implement WebSockets or Server-Sent Events in the backend application. This change allows the server to actively push updates, such as new infrastructure modifications or denied agent actions, directly to the dashboard as soon as they happen. In the dashboard interface, you will need to replace the regular polling mechanism with a persistent connection listener that updates the interface immediately upon receiving new data.

## Step 3: Wire the Action Buttons

The dashboard currently features numerous buttons for registering agents, adding funds, and editing policies, but they are purely decorative. You need to activate these buttons by writing JavaScript functions that trigger when the buttons are clicked. For actions that require user input, such as registering an agent or submitting a new policy, the button click should first display a prompt or a hidden modal interface to gather the necessary details. Once the user submits the information, the JavaScript function must bundle this data and send an HTTP request to the corresponding endpoint you created in the first step.

## Step 4: Connect Specific UI Pages to Subsystems

Different pages on the dashboard correspond to distinct architectural components of the security backbone, and they must be connected accordingly. The Policy Overview page should be wired to communicate with the Policy Agent server to fetch and display the live firewall rules, rather than showing hardcoded examples. The Atlas page, which maps physical infrastructure, needs to fetch dynamic state outputs from the simulation layer. The Product Catalog and Balances pages must query the economic engine to present accurate costs and remaining API budgets calculated by the core system.

## Step 5: Replace Mock Data with Dynamic Rendering

Finally, you need to systematically replace all the hardcoded placeholders in the dashboard interface with dynamic content. The JavaScript code must take the data received from the backend endpoints and inject it into the Document Object Model. This involves clearing out the existing static tables, statistics, and charts, and writing logic that creates new elements based on the live data arrays. Whenever the backend state changes, the dashboard should automatically clear the old information and render the freshly fetched details, ensuring that the visual interface is always a perfectly accurate reflection of the running security backbone.
