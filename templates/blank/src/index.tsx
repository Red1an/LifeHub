import { defineModule, Page, Card } from "@lifehub/sdk";

function Home() {
  return (
    <Page title="__NAME__" subtitle="__DESCRIPTION__">
      <Card>
        <p>Модуль создан. Откройте его папку в Claude Code и опишите, что он должен делать.</p>
      </Card>
    </Page>
  );
}

export default defineModule({
  routes: { "/": Home },
});
