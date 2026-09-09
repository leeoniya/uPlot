export async function renderDemo(groups) {
  const plots = [];

  for (const group of groups) {
    for (const step of group.steps) {
      plots.push(await step.render());

      for (let i = 0; i < (step.breakAfter ?? 0); i++)
        document.body.appendChild(document.createElement('br'));
    }

    for (let i = 0; i < (group.breakAfter ?? 0); i++)
      document.body.appendChild(document.createElement('br'));
  }

  return plots;
}
