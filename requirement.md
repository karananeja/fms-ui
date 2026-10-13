- I am planning to build an app for fleet management service with one module whose primary purpose is to track vehicles on map and tell the user the current state of the vehicle with metrics available from gps and can metrics
  these metrics come from ws and the sample structure is given below
- there are two topics which can happen at per vehicle level or fleet level
  - one gives combinfo - caninfo.md
- another gives caninfo/lafparsed - lafparsed.md

- I have also added few reference media files for design inspiration in the reference
- The app is permission based system
- The app has to have fleet level hierarchy so that i can give access to a dedicate fleet
- vehicles live at the fleet level
- it is invite only sign up platform
- along with sign in, it has forgot password flow
- the user should be able to share the vehicle details with live tracking line which is open for the public
- the module has status bar which acts as search area with fields such as vinno, regno, deviceid and has filters which can update the markers on the map which reflect their current status
- there are few uncommon actions such as
  - table view of the map which supports the entire view of the map in table or shows the view in the current viewport with a button toggle
  - zoom to fit, so that when the map is finished loading on the web view, the ws loads data to the app but the map has been loaded with default india location or the location set by the user in the profile settings
  - a quick city dropdown filter india country
  - a quick locate button of the vehicle
  - download the table view in csv format
- Open street maps shall be used

- state should live in class based file named as live-tracking-store.ts
- web socket data should be established as the app finishes loading
- web socket data should be present and handled inside web worker so that the main thread - client ui is extremely light and can handle a load of about 10 lakh vehicles if needed
- react component should be light weight and the business logic should be inside the class based file mentioned earlier
- file names should be in kebab based naming convention

The application development must follow SDLC process

- create the requirement and spec doc for each of the feature needed in the app
- create the intent for each of the feature, get it verified from the user and once signed off, then proceed with next set of tasks
- create a conversation log for the entire chat
- create a conversation log for each of the feature during implementation
- maintain a record of important decisions made during implementation
- feature should be considered complete only after implementation, testing and user acceptance/sign-off
- create a new/sub agent for implementation of the feature
- ensure while testing the feature, the agent does not get stuck and wait for too long which can derail the development speed

Do not start implementation. First analyze these requirements, identify gaps, and ask me questions required to finalize the technical architecture and tech stack.

Note: do not push the reference media files in github