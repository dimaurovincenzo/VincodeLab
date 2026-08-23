// Mantiene le corsie attive come fa git log --graph: il primo genitore prosegue
// sulla corsia corrente, mentre i merge introducono o ricongiungono corsie adiacenti.
export function layoutGitGraph(commits) {
  const activeLanes = []

  return commits.map((commit) => {
    let lane = activeLanes.indexOf(commit.sha)
    if (lane === -1) {
      lane = activeLanes.length
      activeLanes.push(commit.sha)
    }
    const before = [...activeLanes]

    const primaryParent = commit.parents[0]
    if (primaryParent) {
      const existingLane = activeLanes.indexOf(primaryParent)
      if (existingLane >= 0 && existingLane !== lane) activeLanes.splice(lane, 1)
      else activeLanes[lane] = primaryParent
    } else activeLanes.splice(lane, 1)

    for (const parent of commit.parents.slice(1).reverse()) {
      if (!activeLanes.includes(parent)) activeLanes.splice(lane + 1, 0, parent)
    }

    const links = []
    for (let index = 0; index < before.length; index += 1) {
      const id = before[index]
      const destinations = id === commit.sha ? commit.parents : [id]
      for (const destination of destinations) {
        const nextLane = activeLanes.indexOf(destination)
        if (nextLane >= 0) links.push({ from: index, to: nextLane })
      }
    }

    return { commit, lane, laneCount: Math.max(before.length, activeLanes.length, 1), links }
  })
}
