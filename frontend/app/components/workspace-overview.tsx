export function WorkspaceOverview({
  title,
  workspaceName,
}: {
  title: string;
  workspaceName: string;
}) {
  return (
    <main>
      <h1>{title}</h1>
      <p>
        {workspaceName} workspace access is active. Workspace tools are not
        implemented yet.
      </p>
    </main>
  );
}
