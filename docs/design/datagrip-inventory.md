# DataGrip feature inventory

Reference collected through ChatGPT web search (conversation 6ad9031a, 2026-10-22) from jetbrains.com/help/datagrip. Treat it as a checklist to verify against the official docs, not as a spec; table-craft scope lives in decision 014 and the plans.

### Scope and conventions

The primary reference is [JetBrains DataGrip Help](https://www.jetbrains.com/help/datagrip/), particularly the DataGrip 2026.2 documentation currently available on JetBrains' site. I also distinguish features that may depend on database vendor, driver, edition, plugin, or UI version.

**Shortcut notation:** `⌘` Command, `⌥` Option, `⌃` Control, `⇧` Shift, `↵` Return. Shortcuts are based on JetBrains' [Predefined macOS keymap](https://www.jetbrains.com/help/datagrip/reference-keymap-mac-default.html). An em dash (—) means there is no consistently documented default binding for that action in the references used; it does not mean the action is unavailable.

**Implementation priority:**

Priority legend: **P0** daily-use core · **P1** important · **P2** advanced · **Optional** plugin/vendor-specific.

These priorities are my implementation recommendations, not classifications assigned by JetBrains.

### 1. Main window layout and navigation

DataGrip is a multi-pane IDE, not a single-window SQL client. The interface consists of a main toolbar, dockable tool windows, central editor tabs, database and query results, navigation controls, and a status bar. Tool windows can be resized, moved, split, hidden, floated, or detached.

### 1.1 Main application regions

| Component           | Description                                                                                                             | macOS shortcut | Priority |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------- | -------- |
| Main toolbar/header | Application actions, project controls, search, run controls, and tool-window access.                                    | —              | P0       |
| Main menu           | File, Edit, View, Navigate, Code, Refactor, Run, Tools, VCS, Window, Help, and contextual menus.                        | —              | P0       |
| Editor tab strip    | Open SQL consoles, SQL files, DDL definitions, data tables, and other editors.                                          | —              | P0       |
| Editor work area    | Central area containing code editors, grids, diagrams, and multiple editor splits.                                      | —              | P0       |
| Editor split groups | Display multiple editors horizontally or vertically.                                                                    | —              | P1       |
| Navigation bar      | Hierarchical navigation through project, directories, files, or database context.                                       | `⌥ Home`       | P1       |
| Status bar          | Context indicators including progress, file information, encoding, inspection status, and connections where applicable. | —              | P1       |
| Context menus       | Right-click actions depending on the selected editor, database object, or tool window.                                  | Right-click    | P0       |
| Popup menus         | Lightweight selectors for database, schema, session, dialect, and other contexts.                                       | Varies         | P0       |
| Notifications       | Popups and event history for errors, task completion, connections, and IDE updates.                                     | —              | P1       |
| Search Everywhere   | Global command and entity search overlay.                                                                               | `⇧ ⇧`          | P0       |
| Find Action         | Search menu commands and IDE actions by name.                                                                           | `⌘ ⇧ A`        | P0       |
| Switcher            | Navigate between open editors and tool windows.                                                                         | `⌃ Tab`        | P1       |

### 1.2 Tool windows

| Tool window           | Purpose                                                                  | Default macOS shortcut   | Priority |
| --------------------- | ------------------------------------------------------------------------ | ------------------------ | -------- |
| **Database Explorer** | Browse data sources and hierarchical database objects.                   | `⌘ 1`                    | P0       |
| **Files**             | Project files, SQL scripts, scratch files, and consoles.                 | `⌘ 2`                    | P0       |
| **Find**              | Display and navigate search results.                                     | `⌘ 3`                    | P1       |
| **Run**               | Show execution results from applicable run configurations.               | `⌘ 4`                    | P1       |
| **Debug**             | Debugger sessions, frames, watches, and variables where supported.       | `⌘ 5`                    | P2       |
| **Problems**          | Code analysis errors, warnings, and inspection results.                  | `⌘ 6`                    | P1       |
| **Structure**         | Display the structural outline of the current SQL or supported file.     | `⌘ 7`                    | P1       |
| **Services**          | Connection sessions, consoles, output logs, and query-result tabs.       | `⌘ 8`                    | P0       |
| **Version Control**   | Repository status and supported VCS operations.                          | `⌘ 9`                    | P2       |
| **Commit**            | Stage, review, and commit VCS changes.                                   | `⌘ 0`                    | P2       |
| **Terminal**          | Integrated terminal for commands and database CLI tools.                 | `⌥ F12`                  | P1       |
| **Bookmarks**         | Saved navigation points and bookmark groups.                             | `⌘ F3` to show bookmarks | P1       |
| **Database Changes**  | Review or manage supported database source changes before applying them. | —                        | P2       |
| **AI Assistant**      | AI chat and database-aware assistance when available.                    | —                        | Optional |
| **Notifications**     | View IDE notifications and events.                                       | —                        | P1       |

Some windows are contextual rather than permanently present. The tool-window bar itself can be located in the main header or side bars depending on the interface configuration.

### 1.3 Editor tabs and window interactions

| Feature                  | Description                                              | Shortcut                             |
| ------------------------ | -------------------------------------------------------- | ------------------------------------ |
| Open file/object         | Open database object, file, or console in an editor tab. | `F4` in applicable contexts          |
| Next editor tab          | Move to the next open editor tab.                        | `⌘ ⇧ ]`                              |
| Previous editor tab      | Move to the previous open editor tab.                    | `⌘ ⇧ [`                              |
| Recent files             | Popup of recently visited files/editors.                 | `⌘ E`                                |
| Recent locations         | Navigate previously viewed code locations.               | Via Navigate                         |
| Back / Forward           | Navigate the editor-location history.                    | `⌘ [` / `⌘ ]`                        |
| Pin tab                  | Prevent reusable preview tabs from being replaced.       | —                                    |
| Close tab                | Close the selected tab.                                  | `⌘ W`                                |
| Reopen closed tab        | Restore a recently closed editor.                        | Contextual action                    |
| Move tab to split        | Open editors side-by-side in another editor group.       | —                                    |
| Detach editor            | Open supported editors in another window.                | `⇧ F4` for Open Source in New Window |
| Hide active tool window  | Hide currently focused tool window.                      | `⇧ Esc`                              |
| Hide all tool windows    | Maximize working space for the editor.                   | `⌘ ⇧ F12`                            |
| Jump to last tool window | Restore focus to the last active window.                 | `F12`                                |

### 1.4 New UI, Classic UI, and Islands

| Interface             | Description                                                                                                                              | Clone implication                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| New UI                | Modern JetBrains interface with compact navigation, integrated header, and reorganized tool-window controls.                             | Primary UI target                                         |
| Classic UI            | Earlier JetBrains interface with more traditional toolbars and window presentation; available through a plugin in current documentation. | Compatibility/alternate theme                             |
| Islands theme         | Newer JetBrains visual styling with stronger separation of interface areas and refreshed surfaces.                                       | Visual styling layer, not separate database functionality |
| Compact Mode          | Reduces UI spacing and control sizes.                                                                                                    | Density setting                                           |
| Distraction Free Mode | Minimizes surrounding UI for focused editing.                                                                                            | Layout preset                                             |
| Zen Mode              | Combines reduced chrome and an immersive editing layout.                                                                                 | Layout preset                                             |
| Presentation Mode     | Enlarges content for demonstrations.                                                                                                     | Layout/font preset                                        |

For a clone, model **layout state independently of visual themes**. This lets users change between modern, compact, and classic-inspired presentations without changing editor/session behavior.

Sources: .

---

### 2. Data sources, connections, and sessions

The central configuration surface is **Data Sources and Drivers**, with a left-side data source/driver list and a right-side property editor.

Important detail: a regular data source has five main tabs—**General, Options, SSH/SSL, Schemas, Advanced**. Drivers are managed in a separate section with their own settings. “Drivers” is not a sixth regular data-source tab.

### 2.1 Data source management

| Feature                         | Description                                                           | Shortcut                       | Priority |
| ------------------------------- | --------------------------------------------------------------------- | ------------------------------ | -------- |
| Data Sources and Drivers dialog | Central configuration for connections and drivers.                    | Via File → Data Sources        | P0       |
| Add data source                 | Create a database connection from a vendor template.                  | `⌥ Insert` in relevant dialogs | P0       |
| Duplicate data source           | Copy existing connection properties.                                  | Contextual action              | P1       |
| Rename data source              | Change the connection's display name.                                 | —                              | P0       |
| Remove data source              | Remove a saved connection configuration.                              | Delete action                  | P0       |
| Test connection                 | Verify connectivity, authentication, driver, and target host.         | Button                         | P0       |
| Connect / Disconnect            | Establish or close a database connection.                             | Context menu                   | P0       |
| Data source color               | Assign color to distinguish connections and their associated editors. | —                              | P1       |
| Data source folders             | Organize multiple connections into folders.                           | —                              | P1       |
| Project data sources            | Store data source configurations in the project scope.                | —                              | P1       |
| Global data sources             | Make configurations available across projects.                        | —                              | P1       |
| Share/copy configuration        | Move or copy data-source configuration between contexts.              | —                              | P1       |

### 2.2 General tab

| Field/control         | Description                                                              |
| --------------------- | ------------------------------------------------------------------------ |
| Name                  | Friendly display name for the data source.                               |
| Comment               | Description/annotation for the connection when supported.                |
| Connection type       | Vendor-dependent connection method, including URL-only where applicable. |
| Driver                | Selected JDBC/database driver definition.                                |
| Host                  | Database hostname or IP address.                                         |
| Port                  | Server listening port.                                                   |
| Database              | Target database or database-specific namespace.                          |
| User                  | Authentication username.                                                 |
| Password              | Authentication secret and its storage policy.                            |
| Authentication method | Available authentication options vary by vendor and driver.              |
| URL                   | Generated or manually provided JDBC connection URL.                      |
| Test Connection       | Runs a connection validation and displays results/errors.                |
| Driver download       | Downloads a required compatible driver when available.                   |

Password storage includes options such as saving only until restart or for a connection session, rather than necessarily persisting credentials indefinitely.

### 2.3 Options tab

| Feature                          | Description                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------- |
| Read-only                        | Request read-only behavior to reduce accidental modifications.                   |
| Transaction control              | Choose automatic or manual transaction management.                               |
| Isolation level                  | Configure transaction isolation supported by the database/driver.                |
| Session control                  | Configure how sessions/connections are associated with consoles and operations.  |
| Session templates                | Apply predefined authentication, driver, read-only, and initialization settings. |
| Startup script                   | Execute specified SQL during connection initialization.                          |
| Keep-alive query                 | Maintain idle connectivity using a configured query.                             |
| Time zone                        | Configure connection-specific time zone behavior.                                |
| Introspection settings           | Control what metadata is loaded and how thoroughly.                              |
| Automatic introspection interval | Periodically refresh database metadata.                                          |
| Load Sources                     | Decide whether stored routine/view source is downloaded.                         |
| DDL freshness warning            | Warn when locally cached source differs from the server version.                 |
| Source code style                | Associate formatting preferences with database metadata.                         |
| Before-connection tasks          | Run configured steps before a connection is opened.                              |

**Read-only is not a guaranteed server-side security boundary.** JetBrains explicitly notes that some drivers do not reliably enforce query-console read-only behavior. Your clone should ideally combine UI restrictions, driver flags, and server-side permissions.

### 2.4 SSH/SSL tab

| Feature                     | Description                                                |
| --------------------------- | ---------------------------------------------------------- |
| Use SSH tunnel              | Route database traffic through an SSH host.                |
| SSH configuration selector  | Choose a reusable SSH profile.                             |
| SSH authentication          | Configure key-based or password-based access as supported. |
| SSH forwarding port         | Use a specified or automatically selected local port.      |
| Use SSL/TLS                 | Enable encrypted transport options.                        |
| CA certificate              | Configure certificate authority trust.                     |
| Client certificate          | Provide a client identity certificate.                     |
| Client private key          | Provide a certificate authentication key.                  |
| Truststore                  | Select IDE, Java, or system certificate trust source.      |
| Copy SSH/SSL settings       | Reuse security configuration from another data source.     |
| Driver-specific SSL options | Support DBMS-specific connection properties.               |

Source: [Configure SSH and SSL](https://www.jetbrains.com/help/datagrip/configuring-ssh-and-ssl.html).

### 2.5 Schemas tab and metadata introspection

| Feature                       | Description                                                              |
| ----------------------------- | ------------------------------------------------------------------------ |
| Database/schema selector      | Select namespaces included in browsing and metadata discovery.           |
| Refresh available schemas     | Reload the list of available databases and schemas.                      |
| Schema pattern                | Select namespaces using supported patterns such as `*` or `@`.           |
| Introspection scope           | Define which schemas DataGrip retrieves metadata for.                    |
| Object filter                 | Filter visible objects by name/type patterns.                            |
| Default introspection level   | Choose the metadata detail level loaded by default.                      |
| Incremental introspection     | Refresh changed objects where supported instead of reloading everything. |
| Load routine/view definitions | Fetch database object source code for editing/navigation.                |
| Cached metadata               | Retain schema metadata for code insight and offline browsing scenarios.  |
| Manual synchronize            | Explicitly update locally cached metadata from the database.             |

**Crucial distinction for your clone:** a visible-object filter and introspection scope are different concepts. Hiding a table from the tree does not necessarily prevent DataGrip from retrieving its metadata.

### 2.6 Advanced tab and driver definitions

| Feature                          | Description                                           |
| -------------------------------- | ----------------------------------------------------- |
| Driver property table            | Edit driver-specific connection key/value properties. |
| JVM options                      | Supply runtime flags to the driver process.           |
| Environment variables            | Configure environment variables for the driver.       |
| Driver files                     | Manage driver libraries and native dependencies.      |
| Driver version                   | Choose or update compatible database drivers.         |
| Driver templates                 | Store reusable definitions for supported vendors.     |
| URL templates                    | Define JDBC URL patterns and placeholders.            |
| SQL dialect                      | Associate a dialect with the database driver.         |
| Identifier handling              | Configure database-specific naming behavior.          |
| Driver-specific session defaults | Define common defaults for new connections.           |
| Custom drivers                   | Add third-party or unsupported JDBC drivers.          |

### 2.7 Connection and session architecture

| Feature                       | Description                                                         | Priority |
| ----------------------------- | ------------------------------------------------------------------- | -------- |
| Data source                   | Persistent logical connection configuration.                        | P0       |
| Physical connection           | Actual JDBC/network connection to a database.                       | P0       |
| Session                       | Execution context associated with a connection.                     | P0       |
| Console-to-session attachment | Attach a SQL console to an active or new session.                   | P0       |
| Session switching             | Select the session receiving editor queries.                        | P0       |
| Dedicated sessions            | Separate selected consoles/operations into independent connections. | P1       |
| Shared-session behavior       | Reuse an available connection/session where configured.             | P1       |
| Session naming                | Give active sessions recognizable names.                            | P1       |
| Session lifecycle             | Open, reconnect, disconnect, and close sessions.                    | P0       |
| Transaction state             | Show whether a session has uncommitted work.                        | P0       |
| Session templates             | Reuse initialization and connection behavior.                       | P1       |

Do not equate a data source with a connection or a query console with a session. These are separate application objects. JetBrains documents automatic session creation and the ability to attach consoles to existing sessions.

### 2.8 Authentication and infrastructure integrations

| Integration                | Capability                                                                 | Notes                            |
| -------------------------- | -------------------------------------------------------------------------- | -------------------------------- |
| Username/password          | Standard database authentication.                                          | Core                             |
| Kerberos                   | Ticket-based database authentication.                                      | DBMS/driver-specific             |
| SSH                        | Bastion/jump-host connectivity.                                            | Core connection integration      |
| SSL/TLS                    | Encrypted database connections.                                            | Core                             |
| AWS RDS/Aurora             | Connect using corresponding database engines and supported authentication. | Cloud configuration              |
| AWS Redshift               | Dedicated database vendor support.                                         | Supported                        |
| Amazon DynamoDB            | Dedicated database connection support.                                     | Supported                        |
| Amazon DocumentDB          | Dedicated database connection support.                                     | Supported                        |
| Azure SQL Database         | SQL Server-compatible cloud connections.                                   | Supported                        |
| Google BigQuery            | Cloud analytical query service.                                            | Supported                        |
| Snowflake                  | Cloud warehouse connectivity.                                              | Supported                        |
| Docker-hosted database     | Connect through published ports or supported integration configurations.   | Networking/integration dependent |
| Kubernetes-hosted database | Connect through exposed endpoints or port forwarding.                      | Requires environment setup       |
| Proxy/bastion              | Access restricted database networks.                                       | Transport-specific               |

These represent multiple different integration mechanisms—not one universal “cloud connector” subsystem.

---

### 3. Database Explorer

Database Explorer is the principal navigation tree for live databases, cached metadata, and DDL data sources. It supports keyboard search, grouping, object filtering, contextual commands, and jumping into editors.

### 3.1 Tree node types

| Node type                       | Description                                                      | Priority |
| ------------------------------- | ---------------------------------------------------------------- | -------- |
| Data source                     | Root node representing a configured database connection.         | P0       |
| Data source folder              | User-defined organization for connections.                       | P1       |
| Database / Catalog              | Logical database or catalog depending on DBMS.                   | P0       |
| Schema                          | Namespace grouping database objects.                             | P0       |
| Tables                          | Collection of tables within a database/schema.                   | P0       |
| Table                           | Base relation containing rows and columns.                       | P0       |
| Columns                         | Table fields with type, nullability, default, and metadata.      | P0       |
| Primary key                     | Columns uniquely identifying table rows.                         | P0       |
| Foreign keys                    | Relationships to referenced tables/columns.                      | P0       |
| Indexes                         | Structures used to accelerate retrieval and enforce constraints. | P1       |
| Unique/check constraints        | Integrity rules attached to database objects.                    | P1       |
| Views                           | Stored queries exposed as virtual relations.                     | P0       |
| Materialized views              | Persisted query results where supported.                         | P1       |
| Sequences                       | Database-generated numerical sequence objects.                   | P1       |
| Procedures                      | Named executable database routines.                              | P1       |
| Functions                       | Callable routines returning results or values.                   | P1       |
| Triggers                        | Routines invoked by database events.                             | P1       |
| Types / Domains                 | Custom database data types and domains.                          | P2       |
| Packages                        | Vendor-specific routine and object containers.                   | P2       |
| Synonyms                        | Aliases for database objects.                                    | P2       |
| Users                           | Database security principals.                                    | P1       |
| Roles                           | Named collections of privileges.                                 | P1       |
| Extensions                      | Database extension objects, where applicable.                    | P2       |
| Tablespaces / Storage           | Storage-related objects for supported DBMSs.                     | P2       |
| DDL data sources                | Database structures defined using SQL files.                     | P2       |
| Virtual views and relationships | Local metadata overlays for logical objects and relationships.   | P2       |

Actual node hierarchy differs significantly across PostgreSQL, MySQL, Oracle, SQL Server, MongoDB, and other vendors.

### 3.2 Tree interactions, menus, and tools

| Feature/action                  | Description                                                              | Shortcut                     |
| ------------------------------- | ------------------------------------------------------------------------ | ---------------------------- |
| Expand/collapse                 | Browse children of an object without opening an editor.                  | Arrow keys / click           |
| Speed Search                    | Type a name to locate matching nodes.                                    | Type while tree focused      |
| Speed Search Filter             | Narrow the visible tree to matching objects.                             | Toolbar toggle               |
| Object filter                   | Include/exclude object types or names by rules.                          | —                            |
| Introspection scope selector    | Select visible/introspected schemas, often through an N-of-M indicator.  | Click                        |
| Group by type                   | Present tables, views, routines, and other objects in groups.            | View Options                 |
| Show/hide nodes                 | Control display of object categories and metadata.                       | View Options                 |
| Synchronize / Refresh           | Refresh cached database metadata.                                        | Toolbar/context menu         |
| Autoscroll from Editor          | Reveal the currently selected object in the tree.                        | View Options                 |
| Open Data                       | Open table or view content in a data grid.                               | `F4` for Edit Data           |
| Open DDL                        | Open a database object's definition.                                     | `⌘ B` in navigation contexts |
| Quick Documentation             | Show object information, including relevant columns/definition metadata. | `F1`                         |
| Modify Object                   | Open supported object property editing dialog.                           | `⌃ F6`                       |
| Create Object                   | Create table, schema, view, index, etc.                                  | Context menu → New           |
| Delete/Drop                     | Generate or execute object deletion after confirmation.                  | Delete action                |
| Rename                          | Rename supported objects through a database refactoring action.          | `⇧ F6`                       |
| SQL Generator                   | Generate SQL for selected objects, such as DDL or DML templates.         | Contextual                   |
| Compare Structure With          | Open structural diff and migration preview for two objects.              | Contextual                   |
| Show in Database Explorer       | Locate an object referenced or opened elsewhere.                         | `⌥ F1` → Database Explorer   |
| Copy Name                       | Copy the selected database object name.                                  | Context menu                 |
| Copy Reference / Qualified Name | Copy a contextual database object reference.                             | Context menu                 |
| Drag table into SQL editor      | Insert a database object reference into a statement.                     | Drag/drop                    |
| Drag columns into SQL editor    | Insert column references or selections.                                  | Drag/drop                    |
| Create Query Console            | Open a new data-source-associated console.                               | Context menu                 |
| Jump to Query Console           | Select an existing console associated with the data source.              | Contextual                   |
| Import/Export                   | Access data import, export, dump, and restore actions.                   | Context menu                 |
| Diagrams                        | Visualize selected objects and relationships.                            | Context menu                 |
| Data source properties          | Edit connection and introspection settings.                              | Toolbar/context menu         |

For implementation, preserve two distinct operations: **searching the visible tree** and **searching the whole metadata catalog**. Search Everywhere is able to locate objects beyond the currently expanded nodes, provided their metadata has been indexed.

Sources: .

---

### 4. Query consoles and SQL editor

This is the most interaction-heavy subsystem of a DataGrip clone. The SQL editor combines text editing, parsing, schema-aware language services, session-bound execution, statement history, transaction controls, and results.

### 4.1 SQL document types

| Document type          | Description                                                        | Connection behavior                                         | Priority |
| ---------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------- | -------- |
| Query Console          | Automatically managed console associated with a data source.       | Already attached; session can be selected.                  | P0       |
| Scratch File           | Temporary-purpose SQL file stored in IDE scratch space.            | Must select/attach execution context.                       | P1       |
| User SQL File          | SQL file within an attached directory/project.                     | Can be attached to a data source.                           | P0       |
| Database Object Source | Editable source of a view, procedure, function, or related object. | Connected to its originating object.                        | P1       |
| DDL Data Source File   | SQL representing an offline/local schema definition.               | Associated with DDL data source rather than live execution. | P2       |

A query console is stored under the IDE's internal `Database Consoles` directory, outside ordinary project files. JetBrains automatically creates a console when creating a data source.

### 4.2 Console/editor top toolbar

| Control                  | Description                                                        | Priority |
| ------------------------ | ------------------------------------------------------------------ | -------- |
| Data source selector     | Choose the target database connection.                             | P0       |
| Session selector         | Choose the execution session.                                      | P0       |
| Current schema selector  | Choose current schema/namespace for resolution and execution.      | P0       |
| SQL dialect indicator    | Indicate the SQL grammar associated with the file.                 | P1       |
| Execute                  | Execute the current statement or selected SQL.                     | P0       |
| Execute options          | Choose execution scope and behavior.                               | P0       |
| Explain Plan             | Request query planner output.                                      | P1       |
| Transaction control      | Commit/rollback and transaction-mode interactions where available. | P0       |
| Query history            | Browse previously executed SQL.                                    | P1       |
| Result presentation      | Control whether results appear near the editor or in Services.     | P1       |
| Query execution settings | Open statement execution preferences.                              | P1       |

### 4.3 SQL execution actions

| Feature                | Description                                                                                         | Shortcut             |
| ---------------------- | --------------------------------------------------------------------------------------------------- | -------------------- |
| Execute statement      | Execute SQL at the caret, according to execution settings.                                          | `⌃ ↵`                |
| Execute selection      | Execute only highlighted SQL text.                                                                  | `⌃ ↵`                |
| Execute all statements | Run a sequence of statements/script through the statement chooser or configured execution behavior. | `⌃ ↵` → scope        |
| Statement chooser      | Select which statement or statements should execute.                                                | Triggered by Execute |
| Run SQL file           | Execute attached SQL script using appropriate execution context/configuration.                      | Via Run              |
| Run stored routine     | Supply arguments and invoke a function/procedure.                                                   | Context menu         |
| Run with parameters    | Prompt for placeholder values before execution.                                                     | On execution         |
| Execute to File        | Run a result-producing query directly into an export workflow.                                      | Context menu         |
| Explain Plan           | Display optimizer plan without normally executing the query itself.                                 | Context menu         |
| Explain Analyse        | Execute and show runtime plan statistics where DBMS supports it.                                    | Context menu         |
| Cancel running query   | Request cancellation of active execution.                                                           | Stop control         |
| Open query history     | Browse historical statements for the data source.                                                   | Contextual           |
| Inspect SQL log        | Review database statements emitted by the IDE.                                                      | Help → Show SQL Log  |

**Execution safety:** `EXPLAIN ANALYZE` is not merely a visual variant of `EXPLAIN`: the analyzed query is actually executed. The clone should clearly distinguish these actions, especially for statements that change data.

### 4.4 SQL code editor features

| Feature                  | Description                                                                  | Shortcut                 |
| ------------------------ | ---------------------------------------------------------------------------- | ------------------------ |
| SQL syntax highlighting  | Highlight keywords, literals, identifiers, operators, and errors by dialect. | Automatic                |
| Basic completion         | Suggest keywords, tables, columns, schemas, and supported symbols.           | `⌃ Space`                |
| Type-matching completion | Context-aware completion matching expected types.                            | `⌃ ⇧ Space`              |
| Second completion        | Broaden the completion candidates.                                           | `⌃ ⌥ Space`              |
| Statement completion     | Complete supported code constructs.                                          | `⌘ ⇧ ↵`                  |
| Parameter information    | Display argument information for applicable routines.                        | `⌘ P`                    |
| Quick Documentation      | Show information for an identified SQL symbol.                               | `F1`                     |
| Intentions / Quick Fix   | Suggest context-aware code actions for problems.                             | `⌥ ↵`                    |
| Reformat Code            | Format SQL using configured code style.                                      | `⌘ ⌥ L`                  |
| Comment line             | Comment/uncomment SQL lines.                                                 | `⌘ /`                    |
| Block comment            | Comment/uncomment selected SQL block.                                        | `⌘ ⌥ /`                  |
| Duplicate line/selection | Duplicate selected text.                                                     | `⌘ D`                    |
| Move statement           | Rearrange SQL statements.                                                    | `⌘ ⇧ ↑` / `⌘ ⇧ ↓`        |
| Multi-caret editing      | Edit multiple SQL locations simultaneously.                                  | `⌥ ⇧ Click`              |
| Select next occurrence   | Add another matching selection.                                              | `⌃ G`                    |
| Column selection         | Switch rectangular selection editing.                                        | `⌘ ⇧ 8`                  |
| Code folding             | Collapse/expand SQL blocks or sections.                                      | `⌘ .` for Fold Selection |
| Soft wraps               | Visually wrap long statements without changing the text.                     | Settings/action          |
| Auto indentation         | Automatically align indented SQL structures.                                 | `⌃ ⌥ I`                  |
| Bracket matching         | Navigate and highlight matching parentheses.                                 | `⌃ M`                    |
| Search in editor         | Find matching SQL text.                                                      | `⌘ F`                    |
| Replace in editor        | Replace matching text.                                                       | `⌘ R`                    |
| Inspections              | Flag unresolved references, suspicious expressions, and dialect issues.      | Automatic                |
| Highlight next error     | Navigate to the next detected problem.                                       | `F2`                     |

### 4.5 SQL completion and language intelligence

| Feature                 | Description                                                      | Priority |
| ----------------------- | ---------------------------------------------------------------- | -------- |
| Keyword completion      | Suggest legal SQL clauses/keywords based on grammar position.    | P0       |
| Schema/table completion | Suggest objects using the active metadata catalog.               | P0       |
| Column completion       | Suggest visible columns based on query scope and aliases.        | P0       |
| Alias-aware completion  | Resolve qualified columns through aliases and CTEs.              | P0       |
| Join assistance         | Suggest join conditions from known relationships where possible. | P1       |
| Routine completion      | Suggest stored procedures, functions, and signatures.            | P1       |
| Parameter completion    | Assist with routine arguments.                                   | P1       |
| Wildcard expansion      | Expand `*` into explicit column lists via supported actions.     | P1       |
| Identifier quoting      | Apply correct quoting for the target SQL dialect.                | P1       |
| SQL inspections         | Identify unresolved symbols and potential code problems.         | P1       |
| Quick fixes             | Offer corrections or transformations in context.                 | P1       |
| Live templates          | Expand SQL abbreviations into full statement templates.          | P1       |
| Postfix completion      | Transform SQL fragments using postfix expressions.               | P2       |
| User-defined templates  | Save reusable SQL statements with editable placeholders.         | P1       |

Examples of documented live-template abbreviations include `sel`, `selw`, `selc`, `ins`, and `upd`. Templates expand with `Tab`, and users can move between placeholder fields using `Tab`/`Shift+Tab`. A documented postfix example is `.cfrom`, which builds a SELECT statement using columns from a table.

### 4.6 Code navigation and refactoring

| Feature               | Description                                                  | Shortcut                 |
| --------------------- | ------------------------------------------------------------ | ------------------------ |
| Go to Declaration     | Navigate from a reference to the object's definition.        | `⌘ B`                    |
| Find Usages           | Search indexed references of a SQL symbol.                   | `⌥ F7`                   |
| Show Usages           | Open an inline usage popup.                                  | `⌘ ⌥ F7`                 |
| Rename                | Rename supported symbols and propagate applicable changes.   | `⇧ F6`                   |
| Refactor This         | Show relevant refactoring commands.                          | `⌃ T`                    |
| Introduce Alias       | Create or adjust a table alias in supported SQL.             | Refactor/context action  |
| Qualify identifiers   | Add schema/table qualifiers where appropriate.               | Intention/context action |
| Unqualify identifiers | Remove unnecessary qualifiers when resolvable.               | Intention/context action |
| SQL formatting        | Apply dialect-specific alignment, casing, and spacing rules. | `⌘ ⌥ L`                  |
| File Structure        | Show outline of SQL statements and file elements.            | `⌘ F12`                  |
| Go to Line            | Jump directly to line/column.                                | `⌘ L`                    |
| Highlight Usages      | Highlight references in the current file.                    | `⌘ ⇧ F7`                 |

Not every refactoring applies to every SQL dialect or database object. For a clone, refactoring should be driven by an SQL AST and symbol-resolution model, rather than regular-expression replacements.

### 4.7 SQL dialects, injection, and context resolution

| Feature                      | Description                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------- |
| SQL dialect assignment       | Associate a file/data source with PostgreSQL, MySQL, Oracle, SQL Server, etc. |
| Automatic dialect selection  | Infer SQL dialect from the attached data source/driver.                       |
| Manual dialect override      | Change language interpretation when automatic selection is unsuitable.        |
| SQL language injection       | Recognize/edit SQL embedded within supported host languages or strings.       |
| Current database/schema      | Set namespace used for resolving unqualified object references.               |
| Search path                  | Respect database-specific schema lookup behavior.                             |
| Source attachment            | Associate a standalone SQL file with a data source.                           |
| Resolve modes                | Control how database objects are resolved when names are ambiguous.           |
| Cross-schema references      | Resolve qualified objects across introspected schemas.                        |
| Unresolved-object inspection | Warn when a reference is missing or not resolved by loaded metadata.          |

### 4.8 Query history, execution output, and results

| Component            | Description                                                           |
| -------------------- | --------------------------------------------------------------------- |
| Query History popup  | Search and restore previously executed SQL statements.                |
| SQL Log              | Record database communication queries sent by DataGrip.               |
| Output tab           | Display execution messages, affected rows, and errors.                |
| Result tab           | Display tabular results from SELECT and other returning statements.   |
| Multiple result sets | Display results from scripts that return several result sets.         |
| Result tab titles    | Identify query results by table or customizable labels.               |
| Execution duration   | Indicate query runtime.                                               |
| Error navigation     | Link database errors to relevant editor locations when possible.      |
| In-Editor Results    | Show query results near their corresponding SQL editor.               |
| Services Results     | Show query sessions, outputs, and results in a dedicated tool window. |
| Re-run query         | Execute the previous query again and refresh its result.              |
| Result persistence   | Keep relevant result tabs available for comparison/navigation.        |

The results location is an important UX choice. The same underlying grid functionality should be reusable whether the result is displayed inside the SQL editor, in Services, or in a standalone data-editor tab.

Source: .

---

### 5. Data editor and result grid

DataGrip's data editor works with table/view data, query results, and supported user-file data. It provides server-side and local filtering, grid editing, related-record navigation, value viewers, aggregations, charts, and extractors.

By default, DataGrip limits returned rows to 500 for many grid operations, with configurable paging behavior. A clone should never assume the visible grid represents the entire server-side result.

### 5.1 Grid, pagination, and browsing

| Feature                 | Description                                                                | Priority |
| ----------------------- | -------------------------------------------------------------------------- | -------- |
| Table grid              | Display tabular rows/columns with headers and cell selection.              | P0       |
| Column headers          | Show column names, data types, and contextual controls.                    | P0       |
| Row numbering           | Identify individual visible records.                                       | P0       |
| Page size               | Configure number of rows fetched per page.                                 | P0       |
| Next/previous page      | Move through paginated query results.                                      | P0       |
| Fetch more/all rows     | Retrieve additional results beyond the initial page.                       | P1       |
| Refresh                 | Re-execute or reload data from the database.                               | P0       |
| Go to row               | Navigate to a particular row in available results.                         | P1       |
| Column resizing         | Adjust column width manually.                                              | P0       |
| Column reorder          | Change displayed order through drag/drop.                                  | P1       |
| Column visibility       | Hide or reveal individual columns.                                         | P1       |
| Column pin/freeze       | Keep selected columns visible during horizontal scrolling where supported. | P1       |
| Table/record display    | Switch between grid and record-oriented presentation.                      | P1       |
| Transpose               | Swap rows and columns for inspection.                                      | P1       |
| Grid zoom/fonts         | Customize display density and fonts.                                       | P1       |
| Copy selection          | Copy selected values with the active extractor.                            | P0       |
| Select row/column/range | Support spreadsheet-like mouse and keyboard selections.                    | P0       |

### 5.2 Filtering and sorting

| Feature               | Description                                                                   | Processing location                |
| --------------------- | ----------------------------------------------------------------------------- | ---------------------------------- |
| WHERE filter bar      | Enter an SQL predicate used to retrieve matching rows.                        | Server                             |
| ORDER BY bar          | Specify sorting expressions for the underlying table query.                   | Server                             |
| Quick Filter by Value | Build equality, inequality, null, or related predicates from a selected cell. | Server                             |
| Column header sort    | Sort table records by chosen column.                                          | Local or server, depending on mode |
| Multi-column sort     | Apply ordering using multiple keys.                                           | Depends on selected mode           |
| Local filter          | Restrict visible fetched rows without another database request.               | Client                             |
| Text search           | Highlight or filter matching text within loaded grid data.                    | Client                             |
| Clear filters         | Remove active predicates/local filters.                                       | Both                               |
| Sort reset            | Remove applied sort conditions.                                               | Both                               |

Server-side filtering by WHERE is available for database object data; arbitrary query-result sets do not provide the same server-side filter behavior. A local filter operates only on fetched rows.

### 5.3 Editing records

| Feature                    | Description                                                     | Priority |
| -------------------------- | --------------------------------------------------------------- | -------- |
| Edit cell                  | Modify an editable result field.                                | P0       |
| Edit NULL                  | Assign a null value to a supported cell.                        | P0       |
| Insert row                 | Create a new row in the grid.                                   | P0       |
| Duplicate row              | Use an existing row as a template for insertion.                | P1       |
| Delete row                 | Mark a record for deletion.                                     | P0       |
| Submit changes             | Send pending INSERT, UPDATE, and DELETE operations to database. | P0       |
| Revert changes             | Discard unsubmitted grid modifications.                         | P0       |
| Change highlighting        | Distinguish edited/inserted/deleted data.                       | P0       |
| Default values             | Support database-generated defaults when inserting rows.        | P0       |
| Auto-generated keys        | Handle returned identifiers after insertion.                    | P1       |
| Update preview             | Review pending SQL changes when supported.                      | P1       |
| Read-only indicator        | Clearly indicate that a grid is not editable.                   | P0       |
| Commit                     | Commit a manual transaction.                                    | P0       |
| Rollback                   | Roll back active manual transaction changes.                    | P0       |
| Refresh conflict awareness | Account for server changes since data was loaded.               | P1       |

Data editing has two different state transitions:

Grid edits are local → **Submit** sends them to the database → **Commit** makes them durable. In manual mode Submit ≠ Commit; in auto mode submission commits.

In **Auto** mode, submitting grid edits normally commits them. In **Manual** mode, submitting sends changes within a transaction that still requires a commit or rollback.

### 5.4 Cell value viewers and specialized views

| Feature                | Description                                                              | Priority |
| ---------------------- | ------------------------------------------------------------------------ | -------- |
| Value Editor           | Inspect/edit large text or structured cell values in a dedicated editor. | P1       |
| Single Record View     | Display one record as field/value pairs in a side panel.                 | P1       |
| JSON formatting        | Pretty-print JSON values for readability.                                | P1       |
| XML formatting         | Format supported XML text.                                               | P2       |
| Array editor           | Inspect and edit database array values using a dedicated grid.           | P2       |
| Image viewer           | Preview image content stored in binary fields.                           | P2       |
| Binary/BLOB viewer     | Inspect binary values, including partial loading considerations.         | P2       |
| Hex display            | Inspect binary content using hexadecimal representation where supported. | P2       |
| Geo Viewer             | Render supported geographical/spatial data.                              | P2       |
| Aggregate View         | Calculate summaries for selected cells.                                  | P1       |
| Foreign key navigation | Follow row relationships through stored foreign keys.                    | P1       |
| Referencing rows       | Navigate from a parent row to dependent records.                         | P1       |
| Compare Data           | Compare selected result/table datasets in a diff viewer.                 | P1       |
| Chart view             | Plot numeric/categorical result sets.                                    | P2       |

JetBrains documents chart types including **bar, pie, area, line, scatter, bubble, stock, area range, and histogram**. Chart configuration supports axis selection and grouping.

### 5.5 Aggregation and statistics

| Capability                     | Description                                             |
| ------------------------------ | ------------------------------------------------------- |
| Count                          | Count selected values/cells.                            |
| Sum                            | Sum numeric selections.                                 |
| Average                        | Compute mean of selected numeric values.                |
| Min / Max                      | Determine minimum and maximum values.                   |
| Custom aggregators             | Run user-defined aggregation scripts.                   |
| Aggregate panel                | Display multiple summaries together for selected data.  |
| Data extractors as aggregators | Reuse compatible scripts that produce aggregate values. |

### 5.6 Export, copying, and extractors

| Extractor/output        | Description                                                               | Priority |
| ----------------------- | ------------------------------------------------------------------------- | -------- |
| CSV                     | Comma-delimited file, with quoting and header options.                    | P0       |
| TSV                     | Tab-separated values.                                                     | P0       |
| DSV                     | Custom delimiter-separated values.                                        | P1       |
| JSON                    | Structured JSON output.                                                   | P0       |
| XML                     | XML data output.                                                          | P2       |
| SQL INSERT              | Generate insert statements from selected rows.                            | P1       |
| Markdown                | Produce Markdown tables.                                                  | P1       |
| Excel XLSX              | Export tabular data to a spreadsheet.                                     | P1       |
| HTML/table presentation | Represent grid content in a presentation-friendly format where supported. | P2       |
| Custom extractor        | Define custom serialization using scripts/API.                            | P2       |
| Copy to Clipboard       | Copy selected cells using the currently selected extractor.               | P0       |
| Export to File          | Write extracted data to disk.                                             | P0       |
| Add column headers      | Include field names in supported output formats.                          | P0       |
| Transposed export       | Export rows and columns in switched orientation.                          | P2       |
| Include DDL             | Include object definition in supported SQL-oriented exports.              | P2       |

One subtle but important behavior: **the selected data extractor controls both export and ordinary grid copying**. The most recently selected extractor also becomes the default for newly opened editors, with exceptions for particular database types such as MongoDB. .

---

### 6. Schema tools, object editing, diagrams, and migrations

DataGrip combines graphical schema editing with SQL generation and source-code modification. Create and Modify dialogs are generally object-specific and reflect vendor-specific capabilities discovered during introspection.

### 6.1 Create and Modify dialogs

| Feature               | Description                                                                         | Shortcut           | Priority |
| --------------------- | ----------------------------------------------------------------------------------- | ------------------ | -------- |
| Create Schema         | Create a namespace in a supported database.                                         | Context menu → New | P1       |
| Create Table          | Define a table using a graphical dialog.                                            | Context menu → New | P0       |
| Modify Table          | Change columns, constraints, and database-specific properties.                      | `⌃ F6`             |
| Add/Modify Column     | Edit type, nullability, default, generated expression, and other column properties. | Within Modify      |
| Primary Key           | Define or change primary key columns.                                               | Within Modify      |
| Foreign Key           | Define referenced table, columns, and referential actions.                          | Within Modify      |
| Unique Constraint     | Define uniqueness across selected columns.                                          | Within Modify      |
| Check Constraint      | Define validation expressions for records.                                          | Within Modify      |
| Create/Modify Index   | Edit indexed columns, uniqueness, and supported options.                            | Contextual         |
| Create View           | Define a stored SELECT query.                                                       | Contextual         |
| Create Routine        | Create functions/procedures for supported DBMSs.                                    | Contextual         |
| Create User/Role      | Configure database security objects.                                                | Contextual         |
| Virtual Column        | Define local calculated column metadata where supported.                            | Contextual         |
| Virtual Foreign Key   | Define a relationship locally without altering the physical database.               | Contextual         |
| Preview Generated SQL | Review SQL derived from GUI modifications where provided.                           | Dialog action      |
| Drop Object           | Remove selected database objects with confirmation.                                 | Delete action      |

For tables, the generated SQL depends on actual database capabilities. For example, SQL Server columnstore indexes and newer data types received specific enhancements in DataGrip 2025.3.

### 6.2 DDL and SQL generation

| Feature                | Description                                                     | Priority |
| ---------------------- | --------------------------------------------------------------- | -------- |
| Go to DDL              | Display a cached definition of an object.                       | P0       |
| SQL Generator          | Generate executable SQL for selected database objects.          | P1       |
| CREATE script          | Generate object creation SQL.                                   | P1       |
| DROP script            | Generate object deletion SQL.                                   | P1       |
| INSERT statements      | Generate data insertion statements.                             | P1       |
| UPDATE statements      | Generate update templates/data operations.                      | P1       |
| SELECT statements      | Generate selection templates based on object columns.           | P1       |
| Source object editing  | Edit routines/views in a source editor.                         | P1       |
| DDL diff               | Compare old and proposed object definitions.                    | P1       |
| Generated migration    | Convert supported structure/source changes into executable SQL. | P1       |
| SQL preview            | Inspect automatically generated statements before running them. | P0       |
| Object synchronization | Refresh metadata after successful DDL execution.                | P0       |

### 6.3 Database diagrams

| Feature            | Description                                            | Priority |
| ------------------ | ------------------------------------------------------ | -------- |
| ER/Schema diagram  | Visualize database objects and their relationships.    | P1       |
| Table nodes        | Show tables as diagram elements.                       | P1       |
| Column display     | Show/hide columns inside diagram nodes.                | P1       |
| Key column display | Emphasize primary-key or relationship columns.         | P1       |
| Foreign-key edges  | Show references between tables.                        | P1       |
| Diagram layout     | Reposition elements to improve readability.            | P1       |
| Zoom/pan           | Navigate large diagrams.                               | P1       |
| Object navigation  | Open associated database objects from the diagram.     | P1       |
| Export diagram     | Produce a static or supported portable representation. | P2       |
| Diagram settings   | Control displayed detail, layout, and visual options.  | P2       |

### 6.4 Schema comparison and migration

| Feature                 | Description                                                   | Priority |
| ----------------------- | ------------------------------------------------------------- | -------- |
| Compare Structure With  | Compare two compatible database objects, even across servers. | P1       |
| Origin/Target selection | Define the source and destination of a comparison.            | P1       |
| Added objects           | Highlight objects present only in Origin.                     | P1       |
| Modified objects        | Highlight objects with different definitions.                 | P1       |
| Removed objects         | Identify objects in Target absent from Origin.                | P1       |
| Properties diff         | Compare structure/properties in structured form.              | P1       |
| DDL diff                | Compare SQL definitions side-by-side.                         | P1       |
| Script Preview          | Show a generated script intended to make Target match Origin. | P1       |
| Selective migration     | Include or exclude particular differences.                    | P1       |
| Edit migration script   | Adjust generated SQL before execution.                        | P1       |
| Execute migration       | Apply reviewed changes to Target.                             | P1       |
| Open in console         | Review/run generated SQL in a query console.                  | P1       |
| Ignore differences      | Configure comparison rules where supported.                   | P2       |

JetBrains' migration logic distinguishes **Origin** from **Target** and generates a script to change Target toward Origin; it does not simply produce an unordered diff.

### 6.5 Database Changes tool window

| Feature                 | Description                                                             |
| ----------------------- | ----------------------------------------------------------------------- |
| Pending source changes  | List modified database-object source code not yet submitted.            |
| Group changes           | Organize modified objects for review.                                   |
| Show Diff               | Compare edited source against its database/cached predecessor.          |
| Submit one object       | Apply migration for a selected changed object.                          |
| Submit multiple objects | Submit several supported source changes.                                |
| Script preview          | Verify generated migration SQL.                                         |
| Outdated source warning | Detect potential mismatch between cached and actual server definitions. |
| Refresh/resolve changes | Reconcile the editor with current database metadata.                    |

Database Changes is specifically relevant to database-object source editing. It should not be modeled as a universal pending-change queue for every SQL statement or every uncommitted grid edit.

### 6.6 DDL data sources

| Feature                     | Description                                                   |
| --------------------------- | ------------------------------------------------------------- |
| Create DDL data source      | Represent a database schema using local DDL files.            |
| Parse DDL                   | Build a navigable schema model from SQL definitions.          |
| DDL Mapping                 | Associate an offline DDL data source with a live data source. |
| Dump to DDL                 | Generate/update DDL files from a live database schema.        |
| Update from live source     | Synchronize the DDL representation with a database.           |
| Apply to live database      | Generate schema migration toward the DDL representation.      |
| Scope selection             | Define databases/schemas participating in mappings.           |
| Version control integration | Keep DDL files in an ordinary version-controlled project.     |

Source: .

---

### 7. Import, export, backup, and data movement

### 7.1 CSV/TSV/DSV import wizard

| Feature                   | Description                                                     | Priority |
| ------------------------- | --------------------------------------------------------------- | -------- |
| Import Data from File(s)  | Start importing delimited files into a table/schema.            | P0       |
| CSV/TSV detection         | Recognize supported text-delimited inputs.                      | P0       |
| Delimiter selection       | Configure comma, tab, semicolon, or custom delimiter.           | P0       |
| Quote and escape handling | Correctly parse values containing delimiters or newlines.       | P0       |
| Header detection          | Interpret the first row as column names.                        | P0       |
| Encoding                  | Select the input character encoding.                            | P1       |
| Data preview              | Show parsed values before import.                               | P0       |
| Target schema/table       | Choose destination or create an appropriate new table.          | P0       |
| Column mapping            | Map source columns to target database columns.                  | P0       |
| Column types              | Select or infer field types for new tables.                     | P1       |
| NULL conversion           | Handle empty values and selected null representations.          | P1       |
| Import settings           | Configure import behavior for supported input and target types. | P1       |
| Error reporting           | Show import failures and problematic records.                   | P0       |

### 7.2 Data export

| Feature             | Description                                                      |
| ------------------- | ---------------------------------------------------------------- |
| Export Data to File | Export one or more tables/view datasets.                         |
| Export query result | Save results from SQL execution.                                 |
| Export selection    | Export selected rows/columns or the applicable result scope.     |
| Extractor selector  | Select output serialization format.                              |
| Header options      | Include field/row headers where supported.                       |
| File path selection | Choose the destination.                                          |
| Transpose output    | Exchange rows and columns in the exported result.                |
| Copy to Clipboard   | Export directly to clipboard.                                    |
| Export SQL DDL      | Export database object structure as SQL.                         |
| Execute to File     | Run a SELECT and send result output into a file export workflow. |

### 7.3 Native database dump and restore

| Operation              | Description                                             | Native dependency   |
| ---------------------- | ------------------------------------------------------- | ------------------- |
| PostgreSQL dump        | Back up supported database structures/data.             | `pg_dump`           |
| PostgreSQL restore     | Restore supported dump formats.                         | `pg_restore`        |
| PostgreSQL SQL restore | Execute text SQL dump files.                            | `psql`              |
| MySQL dump             | Create supported database dumps.                        | `mysqldump`         |
| MySQL restore          | Restore through native client execution.                | `mysql`             |
| Run SQL script         | Execute a database SQL file.                            | IDE runner/DBMS     |
| External tools         | Register and launch other database administration CLIs. | External executable |

Native backup/restore depends on installed tools and DBMS support; DataGrip is not a universal backup engine.

### 7.4 Copy between databases

| Feature                   | Description                                                     | Shortcut                   |
| ------------------------- | --------------------------------------------------------------- | -------------------------- |
| Copy Table to             | Copy table data to another schema or data source.               | `F5` in documented context |
| Drag table to destination | Start a copy/import workflow by dragging an object to a schema. | Drag/drop                  |
| Copy to Database          | Copy data from the data editor into another destination.        | Grid toolbar               |
| Source-to-target mapping  | Match source and destination columns/types.                     | Import dialog              |
| Cross-database copy       | Move compatible data between configured database systems.       | Contextual                 |
| Copy within schema        | Duplicate a table's data in an available target.                | Contextual                 |

The copy operation should explicitly separate **copying data**, **copying structure**, and **migrating schema definitions**; these are not interchangeable operations. .

---

### 8. Search, navigation, and recent activity

DataGrip supports search across database objects, code, files, settings, actions, and actual table data. Its speed-search functionality also works inside trees and popup selectors.

### 8.1 Search and navigation inventory

| Feature                      | Description                                                   | macOS shortcut    |
| ---------------------------- | ------------------------------------------------------------- | ----------------- |
| Search Everywhere            | Unified popup for objects, files, actions, and symbols.       | `⇧ ⇧`             |
| Search Everywhere: All       | Search across multiple indexed categories.                    | Search Everywhere |
| Search Everywhere: Files     | Search for matching file names.                               | Search Everywhere |
| Search Everywhere: Symbols   | Search recognized code/database symbols.                      | Search Everywhere |
| Search Everywhere: Actions   | Discover application actions.                                 | Search Everywhere |
| Search Everywhere: Text      | Search indexed text content.                                  | Search Everywhere |
| Find Action                  | Search IDE commands directly.                                 | `⌘ ⇧ A`           |
| Go to File                   | Navigate to a file by name.                                   | `⌘ ⇧ O`           |
| Go to Symbol                 | Navigate to a symbol by name.                                 | `⌘ ⌥ O`           |
| Go to Declaration            | Follow a resolved SQL reference.                              | `⌘ B`             |
| Find Usages                  | Find references of a selected symbol.                         | `⌥ F7`            |
| Show Usages                  | View references in a lightweight popup.                       | `⌘ ⌥ F7`          |
| Find in File                 | Search text inside current editor/grid context.               | `⌘ F`             |
| Replace in File              | Replace text within current file.                             | `⌘ R`             |
| Find in Files / Path         | Search text in project scope.                                 | `⌘ ⇧ F`           |
| Replace in Files / Path      | Replace matching text across a project scope.                 | `⌘ ⇧ R`           |
| Full-Text Search in Database | Search stored values across selected database objects.        | Contextual        |
| Speed Search                 | Filter/navigate a focused tree or list while typing.          | Type directly     |
| File Structure               | Navigate SQL statements/columns and other supported elements. | `⌘ F12`           |
| Recent Files                 | Open recently visited editors and files.                      | `⌘ E`             |
| Recent Changes               | Navigate recently modified locations.                         | `⌥ ⇧ C`           |
| Last Edit Location           | Return to the last edited position.                           | `⌘ ⇧ Delete`      |
| Back / Forward               | Navigate editor history.                                      | `⌘ [` / `⌘ ]`     |
| Select In                    | Locate the current object in a relevant tool window.          | `⌥ F1`            |
| Go to Line                   | Navigate to specific line and column.                         | `⌘ L`             |
| Bookmarks                    | Mark important navigation points.                             | `F3`              |
| Show Bookmarks               | Browse stored bookmarks.                                      | `⌘ F3`            |
| Query History                | Restore previously executed queries.                          | Contextual        |
| Local History                | Recover earlier editor-file contents.                         | Context menu      |

### 8.2 Database full-text search

The workflow is distinct from ordinary SQL text search:

1. Select one or more databases, schemas, or tables in Database Explorer.
2. Invoke **Tools → Full-Text Search**.
3. Provide the value or pattern to find.
4. Review matching objects and records in the Find tool window.
5. Open the relevant record/table for further inspection.

A clone should treat this as an asynchronous database search job, including cancellation, progress reporting, and result limits—not simply `grep` over the local metadata index.

### 8.3 Search Everywhere UX details

| Feature                | Description                                                   |
| ---------------------- | ------------------------------------------------------------- |
| Unified input          | Single search box for navigation/actions.                     |
| Category filters       | Narrow searching to files, symbols, actions, and other types. |
| Fuzzy matching         | Match abbreviated or partially typed identifiers.             |
| Ranked results         | Prioritize relevant or recently used items.                   |
| Keyboard navigation    | Move selection and open results without the mouse.            |
| Search scope           | Filter applicable data sources or project areas.              |
| Inline preview/context | Display useful metadata with search results.                  |
| Action execution       | Execute the selected IDE command directly.                    |
| Search history         | Reuse recently performed searches.                            |
| Abbreviations          | Associate short aliases with frequently used actions.         |
| Text search fallback   | Include text matches in Search Everywhere where configured.   |

---

### 9. Settings and customization

DataGrip distinguishes interface themes from editor color schemes. Changing an application theme does not necessarily change all syntax-highlighting preferences.

### 9.1 UI appearance and themes

| Feature                          | Description                                          | Priority |
| -------------------------------- | ---------------------------------------------------- | -------- |
| Islands Dark                     | Modern separated-surface dark appearance.            | P1       |
| Islands Light                    | Modern separated-surface light appearance.           | P1       |
| Islands Darcula                  | Lower-contrast dark Islands variant.                 | P2       |
| Dark                             | Alternative dark UI theme.                           | P1       |
| Light                            | Alternative light UI theme.                          | P1       |
| Light with Light Header          | Light-theme variant with matching header.            | P2       |
| Darcula                          | Traditional lower-contrast JetBrains dark theme.     | P1       |
| High Contrast                    | Accessibility-focused high-contrast theme.           | P1       |
| Sync with OS                     | Follow macOS light/dark appearance.                  | P1       |
| Different tool-window background | Adjust visual separation of tool windows in Islands. | P2       |
| Compact Mode                     | Reduce padding and interface density.                | P1       |
| Custom themes                    | Install additional themes through plugins.           | P2       |

**Version note:** Islands became the default UI theme in DataGrip 2025.3. JetBrains described it as a visual refresh rather than a change to feature behavior. .

### 9.2 Editor and data display settings

| Setting                   | Description                                                           |
| ------------------------- | --------------------------------------------------------------------- |
| Editor font family        | Font used for SQL and other textual editors.                          |
| Editor font size          | Change code text size.                                                |
| Font ligatures            | Use typographic ligatures when enabled.                               |
| Line spacing              | Control editor vertical spacing.                                      |
| Color scheme              | Configure syntax and editor colors separately from UI theme.          |
| SQL keyword colors        | Customize highlighting of SQL grammar tokens.                         |
| Error/warning colors      | Customize inspection marker appearance.                               |
| Code style                | Configure indentation, capitalization, alignment, spacing, and wraps. |
| Auto formatting           | Apply selected style automatically or on command.                     |
| Data editor font          | Configure grid text appearance.                                       |
| Page size                 | Set grid row-fetch limits.                                            |
| Data type rendering       | Adjust how supported values appear in data grids.                     |
| Date/time formatting      | Configure available date/time display preferences.                    |
| Number formatting         | Customize numeric display/format options.                             |
| NULL display              | Configure the visible representation of NULL values where supported.  |
| Maximum loaded value size | Limit initial loading of large BLOB/CLOB data.                        |
| Grid settings             | Customize presentation, navigation, and editing behavior.             |
| Query execution           | Configure statement selection and execution preferences.              |
| SQL dialect mapping       | Associate files and sources with dialect rules.                       |
| Inspections               | Enable/disable and tune SQL analysis rules.                           |
| Live templates            | Configure reusable SQL snippets.                                      |
| Keymap                    | Customize every supported keyboard command.                           |
| Notifications             | Configure event messages and alerts.                                  |
| Local History retention   | Configure how long local revisions are retained.                      |

### 9.3 Keymaps, plugins, and portability

| Feature                  | Description                                                       | Shortcut           |
| ------------------------ | ----------------------------------------------------------------- | ------------------ |
| Settings                 | Open the IDE settings dialog.                                     | `⌘ ,`              |
| Keymap search            | Search commands and bindings.                                     | Settings → Keymap  |
| Remap shortcut           | Change the binding for a selected action.                         | Settings → Keymap  |
| Keymap presets           | Choose an installed/predefined keyboard scheme.                   | Settings           |
| Plugins Marketplace      | Browse and install available extensions.                          | Settings → Plugins |
| Installed plugins        | Enable, disable, update, or uninstall plugins.                    | Settings → Plugins |
| Theme plugins            | Extend available interface appearances.                           | Marketplace        |
| Language support plugins | Add supported language functionality.                             | Marketplace        |
| VCS integrations         | Add or configure repository-related tooling.                      | Bundled/plugin     |
| Settings import/export   | Transfer supported IDE configurations.                            | Settings actions   |
| Settings Sync            | Synchronize supported preferences across devices when configured. | Settings           |

Sources: .

---

### 10. Other features and integrations

### 10.1 AI Assistant

DataGrip's current AI integration extends beyond autocomplete or text-to-SQL. The DataGrip 2026.2 release documentation describes database-aware agent skills and MCP tools capable of working with configured connections and metadata.

| Feature                      | Description                                                       | Priority |
| ---------------------------- | ----------------------------------------------------------------- | -------- |
| AI Assistant tool window     | Chat interface for working with database-related requests.        | Optional |
| Natural language to SQL      | Generate SQL from a user's description.                           | P2       |
| Schema-aware SQL generation  | Generate SQL using discovered table/column metadata.              | P2       |
| Explain SQL                  | Explain the meaning of selected statements.                       | P2       |
| Query assistance             | Help compose or refine database queries.                          | P2       |
| Connection management agents | Create, diagnose, or update database connection configurations.   | Optional |
| Database exploration agents  | Inspect schemas, tables, and sample records.                      | Optional |
| Agent query execution        | Execute SQL with applicable permissions and safety controls.      | Optional |
| Query result retrieval       | Fetch or reference result data during an AI conversation.         | Optional |
| MCP database tools           | Provide database-related capabilities to compatible AI agents.    | Optional |
| AI execution history         | Include queries executed by AI agents in supported query history. | Optional |
| Schema context attachment    | Supply database schema context to the AI conversation.            | Optional |

JetBrains' 2026.2 documentation names three agent skills: `database-connection-management`, `database-text-to-sql`, and `database-tools`. Availability and authorization depend on the relevant AI tooling and user configuration.

### 10.2 Version control

| Feature                | Description                                             | Priority |
| ---------------------- | ------------------------------------------------------- | -------- |
| Git integration        | Work with SQL/DDL files in Git repositories.            | P1       |
| File change indicators | Show modified files in the project tree/editor.         | P1       |
| Diff Viewer            | Compare file revisions side-by-side.                    | P1       |
| Commit                 | Create commits containing selected file changes.        | P1       |
| Branch switching       | Change active Git branches.                             | P2       |
| Git log/history        | Inspect repository commits and file revisions.          | P2       |
| Conflict resolution    | Resolve merge conflicts with an interactive merge tool. | P2       |
| Shelve changes         | Temporarily store selected file modifications.          | P2       |
| Changelists            | Organize modifications for review/commit.               | P2       |
| VCS annotations        | Inspect authorship of lines where supported.            | P2       |

Version control primarily operates on files, including checked-in SQL and DDL. It is not automatically equivalent to a history of modifications performed directly on live databases.

### 10.3 Run configurations

| Feature                          | Description                                     | Priority |
| -------------------------------- | ----------------------------------------------- | -------- |
| Run/Debug Configuration selector | Choose a configured execution task.             | P1       |
| Run SQL file                     | Execute SQL against a selected database/schema. | P1       |
| Saved run configuration          | Preserve target, script, and execution options. | P1       |
| Execute external tool            | Start an external command or utility.           | P2       |
| Run output                       | View messages from executed scripts.            | P1       |
| Rerun                            | Re-execute a previously configured task.        | P1       |
| Stop                             | Cancel a running task where supported.          | P1       |

JetBrains documents SQL-file execution through run configurations and source-specific execution commands. .

### 10.4 Notebooks and interactive analysis

Notebooks need a product-scope distinction:

| Feature                                                         | Status/description                                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| SQL query console                                               | Core DataGrip interactive SQL execution environment.                                                         |
| SQL file with multiple statements                               | Core supported workflow.                                                                                     |
| In-editor SQL results                                           | Supported query result presentation.                                                                         |
| Chart-based exploration                                         | Supported through the data editor.                                                                           |
| Jupyter-style notebooks                                         | Not established by the reviewed official DataGrip references as a core, general-purpose feature.             |
| Cell-based SQL notebook with Markdown and persisted cell output | Treat as an optional clone enhancement unless independently verified for a specific DataGrip version/plugin. |

For fidelity, implement SQL consoles and in-editor results before attempting a notebook interface.

### 10.5 Database debugging

| Feature                | Description                                           | Priority |
| ---------------------- | ----------------------------------------------------- | -------- |
| Oracle PL/SQL debugger | Debug supported Oracle routines and anonymous blocks. | P2       |
| Breakpoints            | Suspend execution at configured source locations.     | P2       |
| Step Into              | Move execution into a called routine.                 | P2       |
| Step Over              | Execute a line without stepping into a routine.       | P2       |
| Step Out               | Continue until the current routine returns.           | P2       |
| Variable inspection    | View values of variables in the suspended context.    | P2       |
| Watches                | Monitor selected expressions.                         | P2       |
| Evaluate Expression    | Inspect supported expressions during debugging.       | P2       |
| Call stack             | Inspect active execution frames.                      | P2       |
| Resume/Stop            | Continue or terminate debugger activity.              | P2       |

**Important limitation:** JetBrains' DataGrip documentation explicitly limits database debugging support to **Oracle**. Do not advertise generic PostgreSQL, MySQL, or SQL Server stored-procedure debugging as an existing DataGrip capability. .

### 10.6 Users, roles, and database administration

| Feature                    | Description                                                   | Priority |
| -------------------------- | ------------------------------------------------------------- | -------- |
| Browse users               | Inspect accessible database users.                            | P1       |
| Browse roles               | Inspect accessible role definitions.                          | P1       |
| Create user                | Create users where DBMS capabilities and privileges allow it. | P2       |
| Modify user                | Edit supported user properties.                               | P2       |
| Create/modify role         | Manage role objects where supported.                          | P2       |
| Privilege management       | Generate or issue relevant GRANT/REVOKE statements.           | P2       |
| Database object properties | Inspect vendor-specific object configuration.                 | P1       |
| Session inspection         | Access supported active-session information.                  | P2       |
| Administrative SQL         | Execute authorized database administrative commands.          | P1       |

### 10.7 Docker, Kubernetes, and external database infrastructure

| Feature                        | Description                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------- |
| Docker-based databases         | Connect to databases running in containers via accessible network endpoints.    |
| Docker integration             | Use Docker-related tooling where compatible integrations/plugins are available. |
| Kubernetes database connection | Connect to exposed services or forwarded endpoints.                             |
| SSH bastion                    | Reach databases through SSH forwarding.                                         |
| Cloud-managed databases        | Connect using the relevant database driver and authentication settings.         |
| External database CLI          | Run configured tools such as `psql`, `mysql`, or `sqlcmd`.                      |
| Terminal                       | Execute local shell/database administration commands.                           |

These should be treated as a mixture of native connections, external tools, and optional integrations, rather than assuming DataGrip provides a full Kubernetes database-management UI out of the box.

### 10.8 Local History and recovery

| Feature                 | Description                                           | Priority |
| ----------------------- | ----------------------------------------------------- | -------- |
| Automatic Local History | Preserve revisions of local files independent of Git. | P1       |
| Show History            | Inspect a file's earlier revisions.                   | P1       |
| Revision diff           | Compare earlier content against the current file.     | P1       |
| Restore revision        | Restore an earlier file version.                      | P1       |
| Restore fragment        | Recover only selected changed text.                   | P1       |
| Restore deleted file    | Recover files preserved in local history.             | P1       |
| Local History labels    | Mark significant development checkpoints.             | P2       |
| History retention       | Configure the number of days history is maintained.   | P2       |
| Create patch            | Produce a patch from local history differences.       | P2       |

Local History is local, retention-limited, and not a replacement for Git or server-side database auditing. The documentation describes a default retention of five working days. .

---

### 11. Twenty important daily DataGrip workflows

The following are **representative frequent-use workflows**, prioritized from a SQL developer's perspective. They are not an empirical ranking published by JetBrains.

| #   | Workflow                   | Steps                                            | Priority |
| --- | -------------------------- | ------------------------------------------------ | -------- |
| 1   | Connect to a database      | Choose a data source → Test Connection → Connect | P0       |
| 2   | Browse a schema            | Database Explorer → Database → Schema → Tables   | P0       |
| 3   | Inspect a table            | Double-click table → Browse its rows and columns | P0       |
| 4   | Create a query console     | Select data source → New Query Console           | P0       |
| 5   | Write and execute SQL      | Compose SELECT → ⌃ ↵ → Inspect Result            | P0       |
| 6   | Run a selected statement   | Highlight SQL → ⌃ ↵ → Inspect output             | P0       |
| 7   | Find a database object     | ⇧ ⇧ → Type table name → Open                     | P0       |
| 8   | Filter table records       | Open grid → WHERE filter → Apply                 | P0       |
| 9   | Sort and page through rows | Choose sort → Inspect page → Fetch next          | P0       |
| 10  | Edit a row                 | Change cell → Submit → Commit if manual          | P0       |
| 11  | Insert or delete records   | Open editable table → Add/Delete → Submit        | P0       |
| 12  | Export query results       | Execute query → Export Data → CSV/JSON/XLSX      | P0       |
| 13  | Copy data as SQL or CSV    | Select grid cells → Extractor → Copy             | P1       |
| 14  | Inspect table DDL          | Choose object → Go to DDL → Review definition    | P1       |
| 15  | Generate an SQL statement  | Choose object → SQL Generator → Copy/use SQL     | P1       |
| 16  | Inspect related records    | Open grid → Follow foreign-key relationship      | P1       |
| 17  | Review query history       | Open console history → Search → Restore SQL      | P1       |
| 18  | Diagnose slow queries      | Select SQL → Explain Plan → Inspect operators    | P1       |
| 19  | Modify a table structure   | Modify Table → Edit columns/keys → Review SQL    | P1       |
| 20  | Compare schemas            | Select Origin/Target → Diff → Review migration   | P1       |

---

### 12. Recommended architecture for a DataGrip clone

This section is my implementation guidance, not a claim about JetBrains' internal architecture.

A close functional clone needs more than a collection of screens. Its underlying model should keep data-source configurations, physical connections, sessions, consoles, metadata, editors, result sets, and transactions distinct.

Suggested subsystems: Desktop UI shell (tabs, panels, actions, layout) → SQL language service (parser, AST, completion) and metadata catalog (schemas, symbols, cache) → session manager (connections, transactions) and execution engine (queries, results, cancel) → data grid engine (paging, edits, extractors) and schema operations (DDL, diff, migration). Persistent storage, settings and audit history span all layers.

### 12.1 Essential application objects

| Object/model      | State to track                                              |
| ----------------- | ----------------------------------------------------------- |
| `Workspace`       | Open project, layouts, attached directories, settings.      |
| `DataSource`      | Vendor, driver, authentication, properties, schema filters. |
| `Connection`      | Network connection, lifecycle, authentication state.        |
| `Session`         | Session ID, connection, schema, transaction state.          |
| `MetadataCatalog` | Schemas, tables, columns, constraints, cached DDL.          |
| `EditorDocument`  | File content, dialect, dirty state, data-source attachment. |
| `QueryConsole`    | Document, data source, active session, query history.       |
| `Execution`       | SQL, parameters, status, timing, errors, cancellation.      |
| `ResultSet`       | Columns, types, rows, paging, origin, execution ID.         |
| `GridEditBuffer`  | Original values, inserted/updated/deleted rows.             |
| `SchemaChange`    | Target object, proposed DDL, differences, submission state. |
| `Action`          | Stable command ID, enabled state, handler, shortcut.        |

A single central **action registry** is especially valuable. An action such as `database.executeStatement` should be invokable from the toolbar, context menu, keyboard shortcut, Search Everywhere, and command palette without maintaining separate implementations.

### 12.2 Implementation order

- **Phase 1 — Functional SQL client (P0)**: Connection manager, Database Explorer, SQL editor, execute/cancel, result grid, paging, filters, grid edits, commit/rollback, CSV/JSON export, core shortcuts.
- **Phase 2 — Developer-grade database IDE (P1)**: SQL AST, dialect-aware completion, metadata introspection/cache, source navigation, inspections, query history, templates, DDL generation, schema editing, data copying, import wizard.
- **Phase 3 — Advanced DataGrip workflows (P2)**: Schema diff and migration, ER diagrams, Database Changes, stored routine tools, specialized viewers, charts, extensible extractors, database debugging, AI integrations.

### 12.3 Important fidelity boundaries

There are several areas where a visually convincing clone can still behave incorrectly:

- **Session state:** Console A and Console B may have different current schemas, temporary tables, and uncommitted transactions.
- **Metadata state:** The database's current schema, cached introspected metadata, and visible tree filters must remain separate.
- **Editing state:** Modifying a grid locally is not equivalent to sending SQL, and sending SQL is not always equivalent to committing.
- **SQL intelligence:** Completion, navigation, and refactoring depend on the active dialect, attached data source, and schema context.
- **Pagination:** A result grid should distinguish loaded rows from total rows, especially with large result sets.
- **DDL safety:** Schema migrations and destructive operations require previews, clear targets, and error handling.
- **Read-only semantics:** Read-only UI controls do not replace server permissions.
- **Tab lifetime:** Editor documents, results, and sessions should survive independent visibility changes without accidentally terminating an active transaction.

---

### 13. Official JetBrains reference index

These are the best entry points for turning the inventory into detailed screen specifications and acceptance tests.

| Area                        | Official documentation                                                                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application UI and windows  | [User interface](https://www.jetbrains.com/help/datagrip/guided-tour-around-the-user-interface.html) · [Tool windows](https://www.jetbrains.com/help/datagrip/tool-windows.html) |
| Default macOS shortcuts     | [Predefined macOS keymap](https://www.jetbrains.com/help/datagrip/reference-keymap-mac-default.html)                                                                             |
| Connection properties       | [Data Sources and Drivers dialog](https://www.jetbrains.com/help/datagrip/data-sources-and-drivers-dialog.html)                                                                  |
| Introspection               | [Metadata and introspection](https://www.jetbrains.com/help/datagrip/introspection.html)                                                                                         |
| Database navigation         | [Database Explorer](https://www.jetbrains.com/help/datagrip/database-explorer.html)                                                                                              |
| Query consoles              | [Query consoles](https://www.jetbrains.com/help/datagrip/query-consoles.html)                                                                                                    |
| Query execution             | [Run queries](https://www.jetbrains.com/help/datagrip/run-a-query.html)                                                                                                          |
| Data grids                  | [Data editor and viewer](https://www.jetbrains.com/help/datagrip/data-editor-and-viewer.html)                                                                                    |
| Grid exploration and charts | [Explore data in data editor](https://www.jetbrains.com/help/datagrip/explore-data-in-data-editor.html)                                                                          |
| Schema changes              | [Create and Modify dialogs](https://www.jetbrains.com/help/datagrip/create-and-modify-dialogs.html)                                                                              |
| Schema comparison           | [Schema comparison and migration](https://www.jetbrains.com/help/datagrip/schema-comparison-and-migration.html)                                                                  |
| Import and export           | [Import](https://www.jetbrains.com/help/datagrip/import-data.html) · [Export](https://www.jetbrains.com/help/datagrip/export-data.html)                                          |
| Search and navigation       | [Search in DataGrip](https://www.jetbrains.com/help/datagrip/search-in-ide.html)                                                                                                 |
| UI themes                   | [User interface themes](https://www.jetbrains.com/help/datagrip/user-interface-themes.html)                                                                                      |
| Local History               | [Local History](https://www.jetbrains.com/help/datagrip/local-history.html)                                                                                                      |
| Current changes             | [DataGrip release notes](https://www.jetbrains.com/help/datagrip/release-notes-datagrip.html) · [What's New in 2025.3](https://www.jetbrains.com/datagrip/whatsnew/2025-3/)      |

**Version/shortcut caveat:** Some general JetBrains help pages render platform-neutral or Windows-style bindings even when the subject is DataGrip. For the tables above, I used the official macOS keymap as the authority for broadly available actions. Database-specific actions without a clearly verified macOS binding are identified as contextual rather than assigning a speculative shortcut. Likewise, this is a broad functional inventory, not a guarantee that every menu command, vendor-specific dialog field, or plugin-provided action is enumerated.

### Final recommendation for the clone

The most important DataGrip experience is the combination of **Database Explorer + schema-aware SQL editor + session management + result grid**.

Those four areas should share the same underlying metadata and session state. Once they operate consistently, features such as Search Everywhere, SQL generation, data export, schema comparison, and advanced visualizations become much easier to add without introducing conflicting behavior.

For visual fidelity specifically, target the **DataGrip 2025.3+ Islands interface** as the default, while designing the UI layout and command system so that theme and density changes do not affect functionality.

ChatGPT:
---
